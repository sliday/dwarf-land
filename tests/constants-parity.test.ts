import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The simulation exists twice: public/game-worker.js runs it, public/index.html carries a
 * second copy for rendering and the (dead) main-thread fallback. Both declare the same
 * constants independently, and nothing has ever checked that they agree.
 *
 * They already disagreed in ways nothing caught, which is how a tile id in one file can
 * mean a different terrain in the other. This gate fails loudly on the next divergence.
 *
 * When the sim is extracted to public/sim/ this file should be deleted: one declaration
 * cannot drift from itself.
 */

const workerSrc = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');
const indexSrc = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

/** Pull `const T = { ... };` and parse it into a plain object. */
function extractTileEnum(src: string, label: string): Record<string, number> {
  const start = src.indexOf('const T = {');
  if (start === -1) throw new Error(`no tile enum found in ${label}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`unterminated tile enum in ${label}`);
  const body = src.slice(open + 1, end);
  const out: Record<string, number> = {};
  for (const [, key, value] of body.matchAll(/([A-Z_0-9]+)\s*:\s*(-?[0-9.]+)/g)) {
    out[key] = Number(value);
  }
  if (Object.keys(out).length === 0) throw new Error(`empty tile enum in ${label}`);
  return out;
}

/**
 * Find `NAME = <number>` in a const declaration, tolerating comma-separated declarators
 * such as `const STARVE_IMMOBILE = 2000, STARVE_DEATH = 2667;`.
 */
function scalar(src: string, name: string): number | undefined {
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*(-?[0-9.]+)`));
  return m ? Number(m[1]) : undefined;
}

describe('tile enum parity between the two simulation copies', () => {
  const workerT = extractTileEnum(workerSrc, 'game-worker.js');
  const indexT = extractTileEnum(indexSrc, 'index.html');

  it('declares a non-trivial enum in both files', () => {
    expect(Object.keys(workerT).length).toBeGreaterThan(20);
    expect(Object.keys(indexT).length).toBeGreaterThan(20);
  });

  it('assigns every shared tile name the same id', () => {
    const shared = Object.keys(workerT).filter((k) => k in indexT);
    expect(shared.length).toBeGreaterThan(20);
    const mismatches = shared
      .filter((k) => workerT[k] !== indexT[k])
      .map((k) => `${k}: worker=${workerT[k]} index=${indexT[k]}`);
    expect(mismatches).toEqual([]);
  });

  it('never maps two tile names onto the same id within a file', () => {
    for (const [label, table] of [['worker', workerT], ['index', indexT]] as const) {
      const seen = new Map<number, string>();
      const collisions: string[] = [];
      for (const [name, id] of Object.entries(table)) {
        const prior = seen.get(id);
        if (prior) collisions.push(`${label}: ${prior} and ${name} both = ${id}`);
        else seen.set(id, name);
      }
      expect(collisions).toEqual([]);
    }
  });
});

describe('scalar constant parity between the two simulation copies', () => {
  // Only constants that genuinely exist in both files and must agree.
  // WORLD_SEED is duplicated only so both save paths record the same world. If the two
  // drift, a save written by one build claims a base map the other did not generate.
  const shared = ['STARVE_IMMOBILE', 'STARVE_DEATH', 'MAP_W', 'MAP_H', 'WORLD_SEED'];

  it.each(shared)('%s matches across both files', (name) => {
    const w = scalar(workerSrc, name);
    const i = scalar(indexSrc, name);
    expect(w, `${name} missing from game-worker.js`).toBeDefined();
    expect(i, `${name} missing from index.html`).toBeDefined();
    expect(w).toBe(i);
  });
});

describe('the simulation worker has no undefined pathfinder', () => {
  it('never calls findPath, which was never defined and killed the tick loop', () => {
    // Comments mentioning the old name are fine; a call is not.
    const calls = workerSrc
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .filter((line) => /\bfindPath\s*\(/.test(line));
    expect(calls).toEqual([]);
  });

  it('reschedules the tick even when the body throws', () => {
    // A throw that escapes doTick leaves tickTimer unset and the simulation dead.
    expect(workerSrc).toMatch(/function doTick\(\)[\s\S]{0,1200}catch[\s\S]{0,900}tickTimer\s*=\s*setTimeout\(doTick/);
  });
});

/**
 * Every walkable tile needs a speed, or the pathfinder disagrees with the walkability check.
 *
 * `terrainCost` returns Infinity for any tile absent from the speed table:
 *
 *   const props = TERRAIN_PROPS[t];
 *   if (!props || props.speed <= 0) return Infinity;
 *
 * while `isWalkable` consults the WALKABLE set. A tile in one and not the other is a square a
 * dwarf can stand on but `bfs` refuses to enter — the stuck-dwarf signature. Both files shipped
 * with exactly this, and each had a different gap: game-worker.js had no GRAVE entry, so every
 * grave was a permanent wall in the live simulation, and index.html had no PATH entry, so the
 * roads dwarves build were walls to the main-thread pathfinder and buildRoad routed around
 * them at its fallback cost of 5.
 *
 * The tile-enum gate above compares names and ids. It cannot see a missing table row, which is
 * why this is a separate check.
 *
 * Known blind spot: these checks read the initial `WALKABLE` and speed-table literals only. A
 * tile added later by `WALKABLE.add(...)` or `TERRAIN_PROPS[T.X] = ...` would be invisible to
 * all three and a grave-style gap could reappear silently. Neither file does that today.
 */
describe('every walkable tile has a traversal speed', () => {
  /** Pull `const WALKABLE = new Set([...])` and return the bare tile names. */
  function walkableNames(src: string, label: string): string[] {
    const m = src.match(/const WALKABLE = new Set\(\[([\s\S]*?)\]\)/);
    if (!m) throw new Error(`no WALKABLE set in ${label}`);
    const names = [...m[1].matchAll(/T\.([A-Z_0-9]+)/g)].map((x) => x[1]);
    if (names.length === 0) throw new Error(`empty WALKABLE set in ${label}`);
    return names;
  }

  /** Pull the terrain speed table into name -> speed. */
  function speeds(src: string, label: string): Record<string, number> {
    const m = src.match(/const TERRAIN_(?:PROPS|SPEED)s? = \{([\s\S]*?)\n\};/);
    if (!m) throw new Error(`no terrain speed table in ${label}`);
    const out: Record<string, number> = {};
    for (const [, name, value] of m[1].matchAll(/\[T\.([A-Z_0-9]+)\]:\s*\{\s*speed:\s*(-?[0-9.]+)/g)) {
      out[name] = Number(value);
    }
    if (Object.keys(out).length === 0) throw new Error(`empty speed table in ${label}`);
    return out;
  }

  const files: [string, string][] = [
    ['game-worker.js', workerSrc],
    ['index.html', indexSrc],
  ];

  it.each(files)('%s: parses both tables', (label, src) => {
    expect(walkableNames(src, label).length).toBeGreaterThan(20);
    expect(Object.keys(speeds(src, label)).length).toBeGreaterThan(20);
  });

  it.each(files)('%s: no walkable tile is missing a speed', (label, src) => {
    const table = speeds(src, label);
    const missing = walkableNames(src, label).filter((n) => table[n] === undefined);
    expect(missing, `${label}: walkable but no speed, so terrainCost returns Infinity`).toEqual([]);
  });

  it.each(files)('%s: no walkable tile is given a speed of zero', (label, src) => {
    const table = speeds(src, label);
    const blocked = walkableNames(src, label).filter((n) => table[n] !== undefined && table[n] <= 0);
    expect(blocked, `${label}: walkable but speed <= 0, which terrainCost treats as impassable`).toEqual([]);
  });

  it('the two copies agree on every shared speed', () => {
    const w = speeds(workerSrc, 'game-worker.js');
    const i = speeds(indexSrc, 'index.html');
    const shared = Object.keys(w).filter((k) => k in i);
    expect(shared.length).toBeGreaterThan(20);
    const mismatches = shared
      .filter((k) => w[k] !== i[k])
      .map((k) => `${k}: worker=${w[k]} index=${i[k]}`);
    expect(mismatches).toEqual([]);
  });
});
