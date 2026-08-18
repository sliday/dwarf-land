import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * Animals were 126,699 bytes of a 996,183-byte save — 13% of it — held as 799 objects each
 * repeating twelve key names. Packed into positional rows they measure 25,168: 80% off, or
 * 158.6 bytes a head down to 31.5.
 *
 * The TODO that raised this proposed dropping animals from the save entirely, since both copies
 * reseed an empty herd. That is smaller still and wrong for this game: a valley a player had
 * cleared of wolves would refill on reload and the ecosystem would restart every session.
 *
 * Everything here runs the shipped helpers, extracted from both files.
 */

const IDX = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const WRK = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');

function load(src: string, label: string, tableName: string) {
  const L = src.split('\n');
  const grab = (sp: RegExp, ep: RegExp) => {
    const s = L.findIndex((l) => sp.test(l));
    if (s === -1) throw new Error(`${label}: not found ${sp}`);
    const e = L.findIndex((l, i) => i > s && ep.test(l));
    if (e === -1) throw new Error(`${label}: no end for ${sp}`);
    return L.slice(s, e + 1).join('\n');
  };
  const start = src.indexOf('// ---- Animal packing ----');
  const end = src.indexOf('const SAVED_EVENT_LOG', start);
  if (start === -1 || end === -1) throw new Error(`${label}: animal-packing block missing`);
  const ctx: Record<string, any> = { Object, Math, Number, Array, JSON, console };
  createContext(ctx);
  runInContext(
    [
      grab(/^const T = \{/, /^\};/),
      grab(new RegExp('^const ' + tableName + ' = \\{'), /^\};/),
      src.slice(start, end),
      `globalThis.__a = { packAnimals, unpackAnimals: (p) => unpackAnimals(p, ${tableName}), round3, TYPES: ${tableName}, ANIMAL_PACK_ORDER, ANIMAL_PACK_FIXED };`,
    ].join('\n'),
    ctx,
  );
  return ctx.__a;
}
const worker = load(WRK, 'game-worker.js', 'ANIMAL_TYPES');
const page = load(IDX, 'index.html', 'ANIMAL_TYPES_FB');

const wolf = () => ({
  id: 'a_5d7ezh', type: 'wolf', x: 1532, y: 331, hp: 4, maxHp: 11, ac: 13,
  state: 'idle', timer: 0, moveTimer: 0.5999999999999996, owner: null, followTicks: 0,
});

describe('a packed animal comes back intact', () => {
  it('keeps identity, species and position', () => {
    const [a] = worker.unpackAnimals(worker.packAnimals([wolf()]));
    expect(a.id).toBe('a_5d7ezh');
    expect(a.type).toBe('wolf');
    expect(a.x).toBe(1532);
    expect(a.y).toBe(331);
  });

  it('keeps current health, which is not derivable from the species', () => {
    // A wolf at 4 of 11 hp is a wolf a player has already fought.
    const [a] = worker.unpackAnimals(worker.packAnimals([{ ...wolf(), hp: 4 }]));
    expect(a.hp).toBe(4);
  });

  it('keeps a tamed animal with its owner', () => {
    const pet = { ...wolf(), type: 'cat', owner: 'd_17', followTicks: 12 };
    const [a] = worker.unpackAnimals(worker.packAnimals([pet]));
    expect(a.owner).toBe('d_17');
    expect(a.followTicks).toBe(12);
  });

  it('rounds timers rather than storing float noise, within a tick of nothing', () => {
    const [a] = worker.unpackAnimals(worker.packAnimals([wolf()]));
    expect(Math.abs(a.moveTimer - 0.5999999999999996)).toBeLessThan(1e-3);
    expect(JSON.stringify(worker.packAnimals([wolf()]))).not.toContain('0.5999999999999996');
  });
});

describe('what the pack deliberately leaves out', () => {
  it('stores neither maxHp nor ac, both of which follow from the species', () => {
    const packed = JSON.stringify(worker.packAnimals([wolf()]));
    expect(packed).not.toContain('11');   // wolf maxHp
    expect(packed).not.toContain(',13,'); // wolf ac, as a row element
  });

  it("leaves those fields absent so the loader's createAnimal supplies them", () => {
    // The loader does {...createAnimal(type,x,y), ...a}. A key present as undefined would
    // overwrite the freshly derived value with nothing.
    const [a] = worker.unpackAnimals(worker.packAnimals([wolf()]));
    expect('maxHp' in a).toBe(false);
    expect('ac' in a).toBe(false);
  });

  it('truncates trailing defaults, which is most of the saving', () => {
    // An idle animal with no owner ends after moveTimer.
    expect(worker.packAnimals([wolf()])[0]).toEqual(['a_5d7ezh', 'wolf', 1532, 331, 4, 0.6]);
  });

  it('keeps the full row when a late field is set', () => {
    const packed = worker.packAnimals([{ ...wolf(), followTicks: 3 }])[0];
    expect(packed.length).toBe(worker.ANIMAL_PACK_ORDER.length);
  });

  it('never truncates the five structural fields', () => {
    // The cap is derived from the field order, not written by hand: a literal 4 passes every
    // other test here today, purely because hp is never null, and would silently drop health
    // the day it could be.
    expect(worker.ANIMAL_PACK_FIXED).toBe(worker.ANIMAL_PACK_ORDER.indexOf('moveTimer'));
    expect(worker.ANIMAL_PACK_FIXED).toBe(5);
    const starving = { ...wolf(), hp: 0, moveTimer: 0, timer: 0, owner: null, followTicks: 0 };
    const row = worker.packAnimals([starving])[0];
    expect(row.length).toBeGreaterThanOrEqual(5);
    expect(worker.unpackAnimals([row])[0].hp).toBe(0);
  });

  it('drops an animal already dead rather than resurrecting it on load', () => {
    expect(worker.packAnimals([{ ...wolf(), dead: true }])).toEqual([]);
  });
});

describe('shapes the loader has to survive', () => {
  it('passes a pre-packing save through untouched', () => {
    const legacy = wolf();
    expect(worker.unpackAnimals([legacy])[0]).toEqual(legacy);
  });

  it('handles an empty or missing herd', () => {
    expect(worker.unpackAnimals(null)).toEqual([]);
    expect(worker.unpackAnimals([])).toEqual([]);
    expect(worker.packAnimals(undefined)).toEqual([]);
  });

  it('writes the species by name, so reordering the table cannot rewrite old saves', () => {
    // An index would be two bytes cheaper and would silently turn every stored wolf into some
    // other animal the day a species is inserted above it.
    expect(worker.packAnimals([wolf()])[0][1]).toBe('wolf');
    expect(worker.packAnimals([{ ...wolf(), type: 'chimera' }])[0][1]).toBe('chimera');
  });

  it('drops a species this build no longer knows, rather than loading it with no stats', () => {
    const packed = worker.packAnimals([{ ...wolf(), type: 'chimera' }]);
    expect(worker.unpackAnimals(packed)).toEqual([]);
  });

  it('says so when it drops one, rather than losing animals quietly', () => {
    // The city loader warns on a dropped city; this matches it.
    for (const [label, src] of [['index.html', IDX], ['game-worker.js', WRK]] as const) {
      expect(src, `${label} drops unknown species silently`).toContain('[animals] dropping saved animal of unknown species');
    }
  });

  it('survives a row from a build that added fields at the end', () => {
    const row = [...worker.packAnimals([wolf()])[0], 0, 'idle', 0, null, 0, 'future'];
    expect(() => worker.unpackAnimals([row])).not.toThrow();
    expect(worker.unpackAnimals([row])[0].type).toBe('wolf');
  });
});

describe('both copies of the simulation pack the same way', () => {
  const herd = [
    wolf(),
    { ...wolf(), id: 'a_2', type: 'bear', x: 10, y: 20, hp: 19 },
    { ...wolf(), id: 'a_3', type: 'cat', owner: 'd_1', followTicks: 5 },
    { ...wolf(), id: 'a_4', type: 'whale', x: 0, y: 999, moveTimer: 0.25 },
  ];

  it('produces byte-identical output', () => {
    expect(JSON.stringify(page.packAnimals(herd))).toBe(JSON.stringify(worker.packAnimals(herd)));
  });

  it("reads the other copy's output", () => {
    expect(page.unpackAnimals(worker.packAnimals(herd))).toEqual(worker.unpackAnimals(page.packAnimals(herd)));
  });

  it('knows the same species in both copies', () => {
    // Order no longer matters to the format, but a species one copy cannot resolve would be
    // dropped on load by that copy and kept by the other.
    expect(Object.keys(page.TYPES).sort()).toEqual(Object.keys(worker.TYPES).sort());
  });

  it('agrees on the field order', () => {
    expect(page.ANIMAL_PACK_ORDER).toEqual(worker.ANIMAL_PACK_ORDER);
  });
});

describe('the save and load paths actually use it', () => {
  it('packs on save in both copies', () => {
    for (const [label, src] of [['index.html', IDX], ['game-worker.js', WRK]] as const) {
      expect(src, `${label} does not pack animals on save`).toMatch(/animals: packAnimals\(G\.animals\)/);
    }
  });

  it('unpacks on load in both copies', () => {
    for (const [label, src] of [['index.html', IDX], ['game-worker.js', WRK]] as const) {
      expect(src, `${label} does not unpack animals on load`).toMatch(/unpackAnimals\(saved\.animals, ANIMAL_TYPES(_FB)?\)/);
    }
  });

  it('is worth the format change', () => {
    // Measured on the real save: 799 animals, 126,699 bytes -> 25,168.
    const herd = Array.from({ length: 799 }, (_, i) => ({ ...wolf(), id: 'a_' + i }));
    const before = JSON.stringify(herd.map((a) => ({
      id: a.id, type: a.type, x: a.x, y: a.y, hp: a.hp, maxHp: a.maxHp, ac: a.ac,
      state: a.state, timer: a.timer, moveTimer: a.moveTimer, owner: a.owner, followTicks: a.followTicks,
    }))).length;
    const after = JSON.stringify(worker.packAnimals(herd)).length;
    expect(after).toBeLessThan(before * 0.35);
    // And the whole herd must stay well clear of what it displaced.
    expect(before - after).toBeGreaterThan(90_000);
  });
});
