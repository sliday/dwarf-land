import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * Capping `graves` at 500 broke a claim the UI was quietly making. Before the cap,
 * `Object.keys(G.graves).length` happened to equal cumulative deaths, and two labels read it as
 * "N fallen". After the cap those labels would have frozen at "500 fallen" forever, under-reporting
 * further the longer a world ran — a silent wrong number, which is worse than a missing one.
 *
 * Deaths are now counted where dwarves die, and the labels read the counter. Graves stay capped.
 */

const IDX = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const WRK = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');

function loadBounds(src: string, label: string) {
  const start = src.indexOf('// ---- Bounded history ----');
  const end = src.indexOf('const WALKABLE = new Set([', start);
  if (start === -1 || end === -1) throw new Error(`bounded-history block missing from ${label}`);
  const ctx: Record<string, any> = { Object, Math, console };
  createContext(ctx);
  runInContext(
    src.slice(start, end) +
      '\nglobalThis.__b = { rememberGrave, rememberYear, trimGraves, trimYears, MAX_GRAVES, MAX_YEAR_RESOLUTIONS };',
    ctx,
  );
  return ctx.__b;
}
const worker = loadBounds(WRK, 'game-worker.js');
const page = loadBounds(IDX, 'index.html');

describe('the death toll survives grave eviction', () => {
  it('counts every death in the worker, which owns the simulation', () => {
    // All four death paths (combat, starvation, animals, old age) funnel through placeGrave.
    const body = WRK.slice(WRK.indexOf('function placeGrave(d, cause) {'));
    expect(body.slice(0, 400)).toMatch(/G\.stats\.deaths\s*=\s*\(G\.stats\.deaths\s*\|\|\s*0\)\s*\+\s*1/);
  });

  it('counts a dwarf lost at sea, who gets no headstone', () => {
    // The increment must sit above the ocean guard or drownings vanish from the toll.
    const fn = WRK.slice(WRK.indexOf('function placeGrave(d, cause) {'));
    const inc = fn.indexOf('G.stats.deaths');
    const guard = fn.indexOf('!== T.OCEAN');
    expect(inc).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(inc, 'the counter must be reached before the ocean guard can skip the grave').toBeLessThan(guard);
  });

  it('does not count on the page, which takes stats from the worker wholesale', () => {
    // Its only grave writes are the worker sync and the epitaph callback. Neither is a death,
    // and G.stats = data.stats would overwrite any page-side tally anyway.
    expect(IDX).toContain('G.stats = data.stats;');
    expect(IDX.match(/G\.stats\.deaths\s*=\s*\(/g) || []).toEqual([]);
  });

  it('starts both copies at zero rather than undefined', () => {
    expect(WRK).toMatch(/stats:\{[^}]*deaths:0/);
    expect(IDX).toMatch(/stats: \{[^}]*deaths: 0/);
  });
});

describe('the labels report the toll, not the surviving headstones', () => {
  it('shows the death count in the sidebar', () => {
    expect(IDX).toContain("graveRow.textContent = '⚰️ Graveyard: ' + deathCount + ' fallen';");
    expect(IDX).toMatch(/const deathCount = G\.stats\?\.deaths \?\?/);
  });

  it('says so when the panel is only the tail of a longer toll', () => {
    expect(IDX).toContain("' of ' + totalDeaths + ' fallen)'");
  });

  it('falls back to the grave count when a save predates the counter', () => {
    // ?? not ||, so a legitimate zero is not mistaken for a missing field.
    expect(IDX).toMatch(/G\.stats\?\.deaths \?\? Object\.keys\(G\.graves \|\| \{\}\)\.length/);
    expect(IDX).toMatch(/G\.stats\?\.deaths \?\? entries\.length/);
  });
});

describe('a save written before the caps is brought into line on load', () => {
  it('trims oversized history rather than waiting for the next death', () => {
    for (const [label, src] of [['index.html', IDX], ['game-worker.js', WRK]] as const) {
      expect(src, `${label} does not trim graves on load`).toMatch(/trimGraves\(G\.graves\)/);
      expect(src, `${label} does not trim years on load`).toMatch(/trimYears\(G\.yearResolutions\)/);
    }
  });

  it('seeds the counter from the graves such a save carried', () => {
    for (const src of [IDX, WRK]) {
      expect(src).toMatch(/typeof G\.stats\.deaths !== 'number'/);
      expect(src).toMatch(/G\.stats\.deaths = Object\.keys\(G\.graves\)\.length/);
    }
  });

  it('trims a legacy pile in one pass', () => {
    const graves: Record<string, any> = {};
    for (let i = 0; i < worker.MAX_GRAVES * 4; i++) graves[`${i},0`] = { name: 'D' + i };
    worker.trimGraves(graves);
    expect(Object.keys(graves).length).toBe(worker.MAX_GRAVES);
    // The survivors are the newest.
    expect(graves[`${worker.MAX_GRAVES * 4 - 1},0`]).toBeDefined();
    expect(graves['0,0']).toBeUndefined();
  });

  it('trims a legacy chronicle in one pass', () => {
    const list = Array.from({ length: 200 }, (_, i) => ({ year: i + 1 }));
    worker.trimYears(list);
    expect(list.length).toBe(worker.MAX_YEAR_RESOLUTIONS);
    expect(list[list.length - 1].year).toBe(200);
  });

  it('trims identically in both copies', () => {
    const build = () => {
      const g: Record<string, any> = {};
      for (let i = 0; i < 900; i++) g[`${i},2`] = i;
      return g;
    };
    const a = build(), b = build();
    worker.trimGraves(a);
    page.trimGraves(b);
    expect(Object.keys(a)).toEqual(Object.keys(b));
  });
});

describe('a late epitaph does not disturb the eviction queue', () => {
  it('keeps a re-saved grave in its original position', () => {
    // The epitaph callback re-runs rememberGrave on an existing key. If that moved the grave to
    // the back, an old headstone would outlive newer ones and eviction order would drift.
    const graves: Record<string, any> = {};
    for (let i = 0; i < 5; i++) worker.rememberGrave(graves, `${i},0`, { name: 'D' + i });
    worker.rememberGrave(graves, '0,0', { name: 'D0', epitaph: 'Rests well' });
    expect(Object.keys(graves)).toEqual(['0,0', '1,0', '2,0', '3,0', '4,0']);
    expect(graves['0,0'].epitaph).toBe('Rests well');
  });
});
