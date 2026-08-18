import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * A colony founded during play is created inside the worker: `tryFoundCity` pushes onto the
 * worker's own CITIES. The page learns about cities only through the snapshot handler, which
 * used to be:
 *
 *   for (const cd of data.cities) {
 *     const city = cityById(cd.id);
 *     if (city) city.res = cd.res;      // and nothing at all when it is unknown
 *   }
 *
 * so a new colony never reached the page. `getCityResourcesSnapshot` iterates the page's
 * CITIES, so the colony's resources were absent from every save, and `initWorker` re-seeded the
 * worker from the original hard-coded list on the next load. The colonists kept
 * `cityId: 'colony_xxxx'`, `cityOf` fell through to `CITIES[0]`, and they began eating from a
 * city on the other side of the planet.
 *
 * This runs the merge block straight out of public/index.html rather than restating it.
 */

type Harness = {
  merge: (data: any) => void;
  CITIES: any[];
  G: { suburbs: any[] };
};

function loadMergeBlock(): Harness {
  const src = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  // Start at the suburbs assignment, because its position relative to the cities loop is part
  // of what is under test: a promoted suburb keeps its id, and cityById falls back to
  // G.suburbs, so a stale list makes the adoption branch unreachable.
  const start = src.indexOf('        if (data.suburbs) G.suburbs = data.suburbs;');
  if (start === -1) throw new Error('suburbs assignment not found in index.html');
  const endMarker = '\n        if (data.roadGraph)';
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error('end of city merge block not found');
  const block = src.slice(start, end);
  // Guard against silently testing a stub if the block is ever moved or gutted.
  expect(block).toContain('cityById(cd.id)');
  expect(block.length).toBeGreaterThan(200);

  const ctx: Record<string, any> = {
    MAP_W: 2000,
    MAP_H: 1000,
    CITIES: [],
    console,
    Math,
  };
  ctx.G = { suburbs: [] as any[] };
  // Mirrors the page's cityById, including its fallback into G.suburbs.
  ctx.cityById = (id: string) =>
    ctx.CITIES.find((c: any) => c.id === id) || ctx.G.suburbs.find((x: any) => x.id === id);
  createContext(ctx);
  // Wrap so `data` is a parameter rather than a global.
  runInContext(`globalThis.__merge = function (data) {\n${block}\n};`, ctx);
  return { merge: ctx.__merge, CITIES: ctx.CITIES, G: ctx.G };
}

describe('the page adopts colonies the worker founded', () => {
  it('still updates a city it already knows', () => {
    const h = loadMergeBlock();
    h.CITIES.push({ id: 'paris', name: 'Paris', mx: 1010, my: 205, res: { food: 1 } });
    h.merge({ cities: [{ id: 'paris', mx: 1010, my: 205, res: { food: 42 } }] });
    expect(h.CITIES).toHaveLength(1);
    expect(h.CITIES[0].res.food).toBe(42);
  });

  it('adopts a colony it has never seen', () => {
    const h = loadMergeBlock();
    h.merge({
      cities: [{ id: 'colony_ab12', name: 'Durinheim', emoji: '🏕️', mx: 1500, my: 400, res: { food: 20 } }],
    });
    expect(h.CITIES).toHaveLength(1);
    const c = h.CITIES[0];
    expect(c.id).toBe('colony_ab12');
    expect(c.name).toBe('Durinheim');
    expect(c.mx).toBe(1500);
    expect(c.my).toBe(400);
    expect(c.res.food).toBe(20);
  });

  it('gives the adopted colony real lon/lat, so map code that reads them works', () => {
    const h = loadMergeBlock();
    h.merge({ cities: [{ id: 'colony_x', mx: 1500, my: 400, res: {} }] });
    const c = h.CITIES[0];
    // 1500/2000 * 360 - 180 = 90 ; 90 - 400/1000 * 180 = 18
    expect(c.lon).toBeCloseTo(90, 6);
    expect(c.lat).toBeCloseTo(18, 6);
  });

  it('does not adopt a city that has no position yet', () => {
    // Cities are declared before placement assigns mx/my. One without a position cannot be
    // drawn, cannot be pathed to, and would break anything that reads city.mx.
    const h = loadMergeBlock();
    h.merge({ cities: [{ id: 'unplaced', res: {} }] });
    expect(h.CITIES).toHaveLength(0);
  });

  it('adopts each colony once, however many snapshots arrive', () => {
    const h = loadMergeBlock();
    const payload = { cities: [{ id: 'colony_dup', mx: 100, my: 100, res: { food: 5 } }] };
    h.merge(payload);
    h.merge(payload);
    h.merge({ cities: [{ id: 'colony_dup', mx: 100, my: 100, res: { food: 9 } }] });
    expect(h.CITIES).toHaveLength(1);
    expect(h.CITIES[0].res.food).toBe(9);
  });

  it('carries several colonies in one snapshot without dropping any', () => {
    const h = loadMergeBlock();
    h.CITIES.push({ id: 'paris', mx: 1, my: 1, res: { food: 0 } });
    h.merge({
      cities: [
        { id: 'paris', mx: 1, my: 1, res: { food: 3 } },
        { id: 'colony_a', mx: 10, my: 10, res: { food: 1 } },
        { id: 'colony_b', mx: 20, my: 20, res: { food: 2 } },
      ],
    });
    expect(h.CITIES.map((c: any) => c.id).sort()).toEqual(['colony_a', 'colony_b', 'paris']);
    expect(h.CITIES.find((c: any) => c.id === 'paris').res.food).toBe(3);
  });

  it('gives an adopted colony a name and emoji even when the snapshot omits them', () => {
    const h = loadMergeBlock();
    h.merge({ cities: [{ id: 'colony_bare', mx: 5, my: 5, res: {} }] });
    const c = h.CITIES[0];
    expect(typeof c.name).toBe('string');
    expect(c.name.length).toBeGreaterThan(0);
    expect(typeof c.emoji).toBe('string');
    expect(c.emoji.length).toBeGreaterThan(0);
  });
});

describe('a promoted suburb becomes a city on the page too', () => {
  it('adopts it even though it keeps the suburb id', () => {
    // checkSuburbPromotion in the worker reuses sub.id and splices the suburb out, sending the
    // new city and the shrunk suburb list in the SAME snapshot. If the page still holds the old
    // suburb list when it walks data.cities, cityById resolves the id against the suburb that
    // is being promoted away, updates a doomed object and skips adoption — leaving the town in
    // neither collection and its residents falling through to CITIES[0].
    const h = loadMergeBlock();
    h.G.suburbs.push({ id: 'suburb_7', name: 'Ironhollow', mx: 800, my: 300, res: { food: 4 } });
    h.merge({
      suburbs: [],
      cities: [{ id: 'suburb_7', name: 'Ironhollow', emoji: '🏘️', mx: 800, my: 300, res: { food: 11 } }],
    });
    expect(h.G.suburbs).toHaveLength(0);
    expect(h.CITIES.map((c: any) => c.id)).toEqual(['suburb_7']);
    expect(h.CITIES[0].res.food).toBe(11);
    expect(h.CITIES[0].mx).toBe(800);
  });

  it('leaves an ordinary suburb alone', () => {
    const h = loadMergeBlock();
    h.merge({ suburbs: [{ id: 'suburb_9', mx: 10, my: 10, res: {} }], cities: [] });
    expect(h.G.suburbs.map((s2: any) => s2.id)).toEqual(['suburb_9']);
    expect(h.CITIES).toHaveLength(0);
  });
});
