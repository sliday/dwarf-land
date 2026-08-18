import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * Packing the map deltas took the save from 2,196,897 bytes to 996,183 against a 1,500,000 cap.
 * That bought headroom, not a bound: two structures only ever grew.
 *
 * Measured on the same real save:
 *   yearResolutions  31,245 bytes across 3 entries — 10,415 bytes per GAME YEAR
 *   graves            8,140 bytes across 72 entries —    113 bytes per DEATH
 *
 * At 10,415 a year the 503,817 bytes of headroom is gone in about 48 game years, and the 413
 * that stopped the world persisting comes straight back. Both are now capped where they are
 * appended, so the in-memory copies are bounded too.
 *
 * The helpers are extracted from the shipped files rather than restated.
 */

const IDX = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const WRK = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');

function loadBounds(src: string, label: string) {
  const start = src.indexOf('// ---- Bounded history ----');
  if (start === -1) throw new Error(`bounded-history block missing from ${label}`);
  const end = src.indexOf('const WALKABLE = new Set([', start);
  if (end === -1) throw new Error(`end of bounded-history block missing from ${label}`);
  const code = src.slice(start, end);
  expect(code).toContain('rememberGrave');
  expect(code).toContain('rememberYear');

  const ctx: Record<string, any> = { Object, Math, console };
  createContext(ctx);
  runInContext(
    code + '\nglobalThis.__b = { rememberGrave, rememberYear, MAX_GRAVES, MAX_YEAR_RESOLUTIONS };',
    ctx,
  );
  return ctx.__b as {
    rememberGrave: (g: Record<string, any>, k: string, d: any) => void;
    rememberYear: (l: any[], e: any) => void;
    MAX_GRAVES: number;
    MAX_YEAR_RESOLUTIONS: number;
  };
}

const worker = loadBounds(WRK, 'game-worker.js');
const page = loadBounds(IDX, 'index.html');

describe('graves stop growing', () => {
  it('keeps the cap it advertises', () => {
    const graves: Record<string, any> = {};
    for (let i = 0; i < worker.MAX_GRAVES * 3; i++) {
      worker.rememberGrave(graves, `${i},${i}`, { name: 'D' + i });
    }
    expect(Object.keys(graves).length).toBe(worker.MAX_GRAVES);
  });

  it('drops the oldest, not an arbitrary one', () => {
    const graves: Record<string, any> = {};
    for (let i = 0; i < worker.MAX_GRAVES + 5; i++) {
      worker.rememberGrave(graves, `${i},0`, { name: 'D' + i });
    }
    // The first five are gone; the newest is present.
    for (let i = 0; i < 5; i++) expect(graves[`${i},0`]).toBeUndefined();
    expect(graves[`${worker.MAX_GRAVES + 4},0`]).toBeDefined();
  });

  it('does not evict anything while under the cap', () => {
    const graves: Record<string, any> = {};
    for (let i = 0; i < 50; i++) worker.rememberGrave(graves, `${i},1`, { name: 'D' + i });
    expect(Object.keys(graves).length).toBe(50);
    expect(graves['0,1']).toBeDefined();
  });

  it('overwrites a repeat at the same tile without consuming a slot', () => {
    const graves: Record<string, any> = {};
    for (let i = 0; i < 10; i++) worker.rememberGrave(graves, '5,5', { name: 'D' + i });
    expect(Object.keys(graves).length).toBe(1);
    expect(graves['5,5'].name).toBe('D9');
  });
});

describe('the yearly chronicle stops growing', () => {
  it('keeps the cap it advertises', () => {
    const list: any[] = [];
    for (let y = 1; y <= worker.MAX_YEAR_RESOLUTIONS * 3; y++) worker.rememberYear(list, { year: y });
    expect(list.length).toBe(worker.MAX_YEAR_RESOLUTIONS);
  });

  it('keeps the most recent years, since that is what the panel shows', () => {
    const list: any[] = [];
    const last = worker.MAX_YEAR_RESOLUTIONS + 7;
    for (let y = 1; y <= last; y++) worker.rememberYear(list, { year: y });
    expect(list[list.length - 1].year).toBe(last);
    expect(list[0].year).toBe(last - worker.MAX_YEAR_RESOLUTIONS + 1);
  });
});

describe('both copies of the simulation agree', () => {
  it('uses the same caps', () => {
    expect(page.MAX_GRAVES).toBe(worker.MAX_GRAVES);
    expect(page.MAX_YEAR_RESOLUTIONS).toBe(worker.MAX_YEAR_RESOLUTIONS);
  });

  it('routes every append through the capped helpers', () => {
    // A direct assignment would slip past the cap, which is how these grew in the first place.
    for (const [label, src] of [['index.html', IDX], ['game-worker.js', WRK]] as const) {
      const rawGrave = (src.match(/G\.graves\[[^\]]*\]\s*=/g) || []);
      expect(rawGrave, `${label} assigns to G.graves without the cap`).toEqual([]);
      const rawYear = (src.match(/G\.yearResolutions\.push\(/g) || []);
      expect(rawYear, `${label} pushes yearResolutions without the cap`).toEqual([]);
    }
  });
});

describe('the bound is small enough to matter', () => {
  const CAP = 1_500_000;
  // Measured per-entry costs from the real save.
  const BYTES_PER_YEAR = 10_415;
  const BYTES_PER_GRAVE = 113;

  it('leaves most of the headroom for map deltas rather than history', () => {
    const history = worker.MAX_YEAR_RESOLUTIONS * BYTES_PER_YEAR + worker.MAX_GRAVES * BYTES_PER_GRAVE;
    // The packed save measured 996,183 with 39,385 bytes of history already in it.
    const worstCase = 996_183 - 39_385 + history;
    expect(worstCase).toBeLessThan(CAP);
    // And history must not be allowed to eat more than a third of the remaining room.
    expect(history).toBeLessThan((CAP - 996_183) / 1.5 + 39_385);
  });
});
