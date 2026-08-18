import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * A colony survives the session but not the reload.
 *
 * `getSerializableState` used to persist `cityResources` as `{ [cityId]: res }` and nothing
 * else — no name, position or culture for any city. `CITIES` is rebuilt from the hard-coded
 * table on every load, so a saved `colony_ab12` entry had no city to attach to, the resource
 * loop silently skipped it, and `initWorker` re-seeded the worker from the table. The colony
 * and everyone living in it were gone.
 *
 * Both halves of the round-trip below are extracted from public/index.html, not restated.
 */

const SRC = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

/** Run the real getSerializableState against a stub world and return the save object. */
function serialize(cities: any[]): any {
  const start = SRC.indexOf('function getSerializableState()');
  if (start === -1) throw new Error('getSerializableState not found');
  // Take the whole function by brace matching, so the extraction cannot silently truncate.
  const open = SRC.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('unterminated getSerializableState');
  const fn = SRC.slice(start, end + 1);
  expect(fn).toContain('cityResources');
  expect(fn).toContain('colonies');

  const ctx: Record<string, any> = {
    CITIES: cities,
    G: {
      tick: 7, year: 2, season: 1, speed: 1,
      dwarves: [], animals: [], stats: {}, graves: {}, yearResolutions: [],
      suburbs: [], dirtTiles: [], mapDeltas: {}, homeCity: null, upgradeFrom: {},
      aiCityIndex: 0, routeDwarfId: null, paused: false,
    },
    Math, JSON, Object, Array, Number, console,
  };
  createContext(ctx);
  runInContext(fn + '\nglobalThis.__out = getSerializableState();', ctx);
  return ctx.__out;
}

/** Run the real colony-rebuild block from restoreState against a stub CITIES. */
function rebuild(saved: any, cities: any[]): any[] {
  const start = SRC.indexOf('  if (Array.isArray(saved.colonies)) {');
  if (start === -1) throw new Error('colony rebuild block not found in restoreState');
  const endMarker = '\n  if (saved.cityResources) {';
  const end = SRC.indexOf(endMarker, start);
  if (end === -1) throw new Error('end of colony rebuild block not found');
  const block = SRC.slice(start, end);
  expect(block).toContain('CITIES.push({');

  const ctx: Record<string, any> = {
    CITIES: cities, MAP_W: 2000, MAP_H: 1000, Math, Array, Object, console,
  };
  ctx.cityById = (id: string) => ctx.CITIES.find((c: any) => c.id === id);
  createContext(ctx);
  runInContext(`globalThis.__rebuild = function (saved) {\n${block}\n};`, ctx);
  ctx.__rebuild(saved);
  return ctx.CITIES;
}

/** Run the real snapshot merge block, so adoption and persistence are tested as one path. */
function adopt(snapshotCities: any[], cities: any[]): any[] {
  const start = SRC.indexOf('        if (data.suburbs) G.suburbs = data.suburbs;');
  if (start === -1) throw new Error('snapshot merge block not found');
  const end = SRC.indexOf('\n        if (data.roadGraph)', start);
  if (end === -1) throw new Error('end of snapshot merge block not found');
  const block = SRC.slice(start, end);
  expect(block).toContain('CITIES.push({');

  const ctx: Record<string, any> = {
    CITIES: cities, MAP_W: 2000, MAP_H: 1000, Math, Object, Array, console,
    G: { suburbs: [] as any[] },
  };
  ctx.cityById = (id: string) =>
    ctx.CITIES.find((c: any) => c.id === id) || ctx.G.suburbs.find((x: any) => x.id === id);
  createContext(ctx);
  runInContext(`globalThis.__merge = function (data) {\n${block}\n};`, ctx);
  ctx.__merge({ cities: snapshotCities });
  return ctx.CITIES;
}

describe('a colony founded in the worker survives all the way to the next session', () => {
  it('is adopted, saved, and rebuilt without anyone marking it by hand', () => {
    // The whole chain, each step running shipped code: the worker snapshot arrives, the page
    // adopts the colony, the save records it, a fresh session starts from the hard-coded table,
    // and the restore puts it back. Nothing here sets `founded` itself — if the adoption branch
    // stops marking adopted cities, the save silently drops them again and this fails.
    const pageCities = [{ id: 'paris', name: 'Paris', mx: 1, my: 1, res: { food: 5 } }];
    const afterSnapshot = adopt(
      [{ id: 'colony_ab12', name: 'Durinheim', emoji: '\u{1F3D5}\uFE0F', mx: 1500, my: 400, res: { food: 20 } }],
      pageCities,
    );
    expect(afterSnapshot.map((c: any) => c.id).sort()).toEqual(['colony_ab12', 'paris']);

    const save = serialize(afterSnapshot);
    expect(save.colonies.map((c: any) => c.id)).toEqual(['colony_ab12']);

    const freshFromTable = [{ id: 'paris', name: 'Paris', mx: 1, my: 1, res: { food: 0 } }];
    const restored = rebuild(save, freshFromTable);
    expect(restored.map((c: any) => c.id).sort()).toEqual(['colony_ab12', 'paris']);
    expect(restored.find((c: any) => c.id === 'colony_ab12').res.food).toBe(20);
  });

  it('does not save an ordinary city as a colony after a snapshot', () => {
    const pageCities = [{ id: 'paris', name: 'Paris', mx: 1, my: 1, res: { food: 5 } }];
    const after = adopt([{ id: 'paris', mx: 1, my: 1, res: { food: 6 } }], pageCities);
    expect(serialize(after).colonies).toEqual([]);
  });
});

/**
 * The worker owns the real save. `saveGameState` posts `save_request` to it whenever a worker
 * exists, and the worker answers with its OWN getSerializableState — so the page's serializer
 * is the fallback-only path. The first version of this fix edited only the page's, which meant
 * colonies still vanished in every browser that supports Worker.
 */
function serializeWorker(cities: any[]): any {
  const wsrc = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');
  const start = wsrc.indexOf('function getSerializableState()');
  if (start === -1) throw new Error('worker getSerializableState not found');
  const open = wsrc.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < wsrc.length; i++) {
    if (wsrc[i] === '{') depth++;
    else if (wsrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('unterminated worker getSerializableState');
  const fn = wsrc.slice(start, end + 1);
  expect(fn).toContain('colonies');

  const ctx: Record<string, any> = {
    CITIES: cities,
    G: {
      tick: 3, year: 1, season: 0, speed: 1,
      dwarves: [], animals: [], stats: {}, graves: {}, yearResolutions: [],
      suburbs: [], dirtTiles: [], mapDeltas: {}, homeCity: null, upgradeFrom: {},
      aiCityIndex: 0, routeDwarfId: null, paused: false,
    },
    Math, JSON, Object, Array, Number, console,
  };
  createContext(ctx);
  runInContext(fn + '\nglobalThis.__w = getSerializableState();', ctx);
  return ctx.__w;
}

describe('the worker save carries colonies too', () => {
  it('is the serializer that actually reaches the server, and it persists colonies', () => {
    const out = serializeWorker([
      { id: 'paris', name: 'Paris', mx: 1, my: 1, res: { food: 5 } },
      { id: 'colony_w1', name: 'Newholm', emoji: '\u{1F3D5}\uFE0F', mx: 900, my: 250, culture: 'american', res: { food: 12 }, founded: true },
    ]);
    expect(out.colonies.map((c: any) => c.id)).toEqual(['colony_w1']);
    expect(out.colonies[0].mx).toBe(900);
    expect(out.colonies[0].res.food).toBe(12);
  });

  it('does not mistake a seeded city for a colony', () => {
    const out = serializeWorker([{ id: 'paris', name: 'Paris', mx: 1, my: 1, res: {} }]);
    expect(out.colonies).toEqual([]);
  });

  it('marks the cities it creates, so the filter has something to select', () => {
    // Both worker-side creation sites must set the flag, or the serializer above finds nothing.
    const wsrc = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');
    const pushes = wsrc.match(/^\s*CITIES\.push\(\w+\);$/gm) || [];
    expect(pushes.length).toBe(2);
    const marks = wsrc.match(/^\s*\w+\.founded = true;$/gm) || [];
    expect(marks.length).toBe(2);
  });

  it('round-trips a worker save through the page rebuild', () => {
    const workerSave = serializeWorker([
      { id: 'colony_w2', name: 'Deepforge', emoji: '\u{1F3D5}\uFE0F', mx: 1500, my: 400, culture: 'french', res: { food: 7 }, founded: true },
    ]);
    const restored = rebuild(workerSave, [{ id: 'paris', res: {} }]);
    expect(restored.map((c: any) => c.id).sort()).toEqual(['colony_w2', 'paris']);
    expect(restored.find((c: any) => c.id === 'colony_w2').res.food).toBe(7);
  });
});

describe('the save carries colonies, not just their resources', () => {
  it('writes nothing extra when there are no colonies', () => {
    const out = serialize([{ id: 'paris', name: 'Paris', res: { food: 1 } }]);
    expect(out.colonies).toEqual([]);
    expect(out.cityResources.paris).toEqual({ food: 1 });
  });

  it('writes a founded city with the identity needed to rebuild it', () => {
    const out = serialize([
      { id: 'paris', name: 'Paris', res: { food: 1 } },
      {
        id: 'colony_ab12', name: 'Durinheim', emoji: '🏕️', mx: 1500, my: 400,
        lon: 90, lat: 18, culture: 'french', res: { food: 20 }, founded: true,
      },
    ]);
    expect(out.colonies).toHaveLength(1);
    const c = out.colonies[0];
    expect(c).toMatchObject({
      id: 'colony_ab12', name: 'Durinheim', mx: 1500, my: 400, culture: 'french',
    });
    expect(c.res.food).toBe(20);
  });

  it('does not treat a hard-coded city as a colony', () => {
    const out = serialize([
      { id: 'paris', name: 'Paris', mx: 1, my: 1, res: {} },
      { id: 'tokyo', name: 'Tokyo', mx: 2, my: 2, res: {} },
    ]);
    expect(out.colonies).toEqual([]);
  });
});

describe('the load rebuilds colonies before anything looks them up', () => {
  it('puts a saved colony back into CITIES', () => {
    const cities = [{ id: 'paris', res: {} }];
    const out = rebuild({
      colonies: [{ id: 'colony_ab12', name: 'Durinheim', emoji: '🏕️', mx: 1500, my: 400, culture: 'french', res: { food: 20 } }],
    }, cities);
    expect(out.map((c: any) => c.id).sort()).toEqual(['colony_ab12', 'paris']);
    const c = out.find((x: any) => x.id === 'colony_ab12');
    expect(c.mx).toBe(1500);
    expect(c.res.food).toBe(20);
    expect(c.founded).toBe(true);
  });

  it('keeps the colony marked so the next save carries it again', () => {
    const rebuilt = rebuild({ colonies: [{ id: 'c1', mx: 10, my: 10, res: { food: 3 } }] }, []);
    const out = serialize(rebuilt);
    expect(out.colonies.map((c: any) => c.id)).toEqual(['c1']);
  });

  it('recomputes lon/lat when an older save lacks them', () => {
    const out = rebuild({ colonies: [{ id: 'c2', mx: 1500, my: 400, res: {} }] }, []);
    const c = out[0];
    expect(c.lon).toBeCloseTo(90, 6);
    expect(c.lat).toBeCloseTo(18, 6);
  });

  it('skips a colony with no position rather than creating a broken city', () => {
    const out = rebuild({ colonies: [{ id: 'nowhere', res: {} }] }, []);
    expect(out).toEqual([]);
  });

  it('does not duplicate a colony that is somehow already present', () => {
    const cities = [{ id: 'c3', mx: 1, my: 1, res: { food: 1 } }];
    const out = rebuild({ colonies: [{ id: 'c3', mx: 1, my: 1, res: { food: 99 } }] }, cities);
    expect(out).toHaveLength(1);
    expect(out[0].res.food).toBe(1);
  });

  it('tolerates a save written before colonies existed', () => {
    expect(rebuild({}, [{ id: 'paris', res: {} }]).map((c: any) => c.id)).toEqual(['paris']);
    expect(rebuild({ colonies: null }, []).length).toBe(0);
  });

  it('survives a full save, reload, save cycle without losing the colony', () => {
    // The thing that actually failed: found a colony, save, start from the hard-coded table,
    // restore, and check it is still there and still carries its resources.
    const live = [
      { id: 'paris', name: 'Paris', mx: 1, my: 1, res: { food: 5 } },
      { id: 'colony_x', name: 'Newholm', emoji: '🏕️', mx: 900, my: 250, culture: 'american', res: { food: 12 }, founded: true },
    ];
    const save = serialize(live);
    const freshFromTable = [{ id: 'paris', name: 'Paris', mx: 1, my: 1, res: { food: 0 } }];
    const restored = rebuild(save, freshFromTable);
    expect(restored.map((c: any) => c.id).sort()).toEqual(['colony_x', 'paris']);
    expect(restored.find((c: any) => c.id === 'colony_x').res.food).toBe(12);
    // And it is still marked, so the cycle is stable rather than one-shot.
    expect(serialize(restored).colonies).toHaveLength(1);
  });
});
