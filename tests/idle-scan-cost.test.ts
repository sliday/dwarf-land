import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * These tests execute public/game-worker.js itself. They exist because two searches grew with
 * the world instead of with the work:
 *
 *  - aiIdle ran up to five uncapped `bfs` scans per idle dwarf looking for designated work.
 *    With nothing designated every one of them expanded the full 30,000-node cap (~45 ms each
 *    on the 2000x1000 map) before returning null, against a 33-100 ms tick.
 *  - rebuildRoadGraph did a linear CITIES.find per visited tile and shifted an array queue,
 *    then ran inline inside whichever tryTravel call came next.
 *
 * Both are invisible to a unit test that mirrors the logic, so this file loads the shipped
 * file the way tests/road-repair.test.ts does and pokes the real functions.
 */

type Hooks = {
  bfs: (sx: number, sy: number, goal: (x: number, y: number) => boolean, walkToGoal: boolean, maxSteps?: number) => number[][] | null;
  anyDesignation: (tiles: number[]) => boolean;
  indexDesignation: (x: number, y: number, tile: number) => void;
  mapSet: (x: number, y: number, tile: number) => void;
  rebuildRoadGraph: () => void;
  rebuildDesignationIndex: () => void;
  tryTravel: (d: any) => boolean;
  tryFoundCity: (d: any) => boolean;
  carryCapacity: (d: any) => number;
  aiIdle: (d: any) => void;
  createDwarf: (x: number, y: number, cityId: string) => any;
  G: Record<string, any>;
  T: Record<string, number>;
  MAP_W: number;
  MAP_H: number;
  setCities: (cities: any[]) => void;
  getCities: () => any[];
  setMap: (map: Uint8Array[]) => void;
  countBfsCalls: () => number;
  resetBfsCalls: () => void;
  bfsCaps: () => (number | undefined)[];
  onmessage: (e: { data: any }) => void;
  setRandom: (v: number) => void;
  indexSize: () => number;
};

function loadWorker(): Hooks {
  const workerCode = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8') + `
// Count every bfs entry so a test can prove a scan was skipped rather than merely fast.
const __realBfs = bfs;
let __bfsCalls = 0;
let __bfsArgs = [];
bfs = function(...args) { __bfsCalls++; __bfsArgs.push(args[4]); return __realBfs.apply(null, args); };
self.__hooks = {
  bfs: __realBfs,
  anyDesignation,
  indexDesignation,
  mapSet,
  rebuildRoadGraph,
  rebuildDesignationIndex,
  tryTravel,
  tryFoundCity,
  carryCapacity,
  aiIdle,
  createDwarf,
  G, T, MAP_W, MAP_H,
  setCities: (cities) => { CITIES = cities; },
  getCities: () => CITIES,
  setMap: (map) => { G.map = map; },
  countBfsCalls: () => __bfsCalls,
  resetBfsCalls: () => { __bfsCalls = 0; __bfsArgs = []; },
  bfsCaps: () => __bfsArgs,
  onmessage: (e) => self.onmessage(e),
  indexSize: () => { let n = 0; for (const s of designationIndex.values()) n += s.size; return n; },
};`;
  // The worker gets its own Math so a test can pin Math.random without reaching the host's.
  const vmMath: any = Object.create(Math);
  const context: Record<string, any> = {
    // init starts the tick loop, which posts a snapshot immediately.
    self: { postMessage: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Uint8Array,
    console,
    Math: vmMath,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  createContext(context);
  runInContext(workerCode, context);
  const hooks = context.self.__hooks as Hooks;
  hooks.setRandom = (v: number) => { vmMath.random = () => v; };
  return hooks;
}

/** All ocean except a single walkable west-east corridor on `row`, so search cost ~= distance. */
function corridorMap(w: Hooks, row: number, fromX: number, toX: number): Uint8Array[] {
  const map = Array.from({ length: w.MAP_H }, () => new Uint8Array(w.MAP_W).fill(w.T.OCEAN));
  for (let x = fromX; x <= toX; x++) map[row][x] = w.T.PLAINS;
  return map;
}

describe('bfs step cap', () => {
  let w: Hooks;
  beforeEach(() => { w = loadWorker(); });

  it('reaches a distant goal with the default cap', () => {
    const row = 500;
    w.setMap(corridorMap(w, row, 100, 500));
    const path = w.bfs(100, row, (x, y) => x === 400 && y === row, false);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(300);
  });

  it('gives up before the goal when maxSteps is smaller than the distance', () => {
    const row = 500;
    w.setMap(corridorMap(w, row, 100, 500));
    const path = w.bfs(100, row, (x, y) => x === 400 && y === row, false, 50);
    expect(path).toBeNull();
  });

  it('still finds a goal that fits inside maxSteps', () => {
    const row = 500;
    w.setMap(corridorMap(w, row, 100, 500));
    const path = w.bfs(100, row, (x, y) => x === 120 && y === row, false, 50);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(20);
  });
});

describe('designation index', () => {
  let w: Hooks;
  beforeEach(() => {
    w = loadWorker();
    w.setMap(Array.from({ length: w.MAP_H }, () => new Uint8Array(w.MAP_W).fill(w.T.PLAINS)));
  });

  it('reports nothing designated on a fresh map', () => {
    expect(w.anyDesignation([w.T.D_MINE])).toBe(false);
    expect(w.anyDesignation([w.T.D_FARM])).toBe(false);
    expect(w.anyDesignation([w.T.D_ROAD, w.T.D_UPGRADE])).toBe(false);
  });

  it('sees a designation painted through the designate message', () => {
    w.onmessage({ data: { type: 'designate', changes: [{ x: 40, y: 40, tile: w.T.D_MINE }] } });
    expect(w.G.map[40][40]).toBe(w.T.D_MINE);
    expect(w.anyDesignation([w.T.D_MINE])).toBe(true);
    expect(w.anyDesignation([w.T.D_FARM])).toBe(false);
  });

  it('forgets a designation once the work completes through mapSet', () => {
    w.onmessage({ data: { type: 'designate', changes: [{ x: 41, y: 41, tile: w.T.D_FARM }] } });
    expect(w.anyDesignation([w.T.D_FARM])).toBe(true);
    w.mapSet(41, 41, w.T.FARM);
    expect(w.anyDesignation([w.T.D_FARM])).toBe(false);
  });

  it('does not grow with completed work', () => {
    // Self-healing alone would keep anyDesignation correct, but the index would then carry one
    // dead entry per finished designation for the life of the session. mapSet drops each entry
    // as the work completes, so the index stays proportional to outstanding work, not history.
    for (let x = 100; x < 300; x++) {
      w.onmessage({ data: { type: 'designate', changes: [{ x, y: 60, tile: w.T.D_MINE }] } });
    }
    expect(w.indexSize()).toBe(200);
    for (let x = 100; x < 300; x++) w.mapSet(x, 60, w.T.FLOOR);
    expect(w.indexSize()).toBe(0);
  });

  it('indexes designations that arrive with the init map', () => {
    // init replaces G.map with a flat buffer built by the page, designations included. It is
    // the only bootstrap message index.html ever sends, so an index that missed it would start
    // empty on every reload and dwarves would ignore all outstanding work until it was
    // redesignated by hand.
    const flat = new Uint8Array(w.MAP_W * w.MAP_H).fill(w.T.PLAINS);
    flat[500 * w.MAP_W + 210] = w.T.D_MINE;
    flat[500 * w.MAP_W + 211] = w.T.D_FARM;
    w.onmessage({ data: { type: 'init', map: flat.buffer, cities: [], cultures: {}, dwarfNames: [], surnames: [], dwarves: [] } });
    expect(w.G.map[500][210]).toBe(w.T.D_MINE);
    expect(w.anyDesignation([w.T.D_MINE])).toBe(true);
    expect(w.anyDesignation([w.T.D_FARM])).toBe(true);
    expect(w.anyDesignation([w.T.D_ROAD])).toBe(false);
  });

  it('clears entries from a previous world when the index is rebuilt', () => {
    w.indexDesignation(700, 700, w.T.D_MINE);
    w.G.map[700][700] = w.T.D_MINE;
    expect(w.anyDesignation([w.T.D_MINE])).toBe(true);
    w.G.map[700][700] = w.T.PLAINS;
    w.rebuildDesignationIndex();
    expect(w.indexSize()).toBe(0);
  });

  it('sees designations replayed from a restored save', () => {
    // anyDesignation only ever deletes; nothing re-adds. If the restore replay skipped the
    // index, every designation in a loaded save would be invisible for the whole session and
    // dwarves would ignore all designated work after a page reload.
    w.onmessage({ data: { type: 'restore', state: { tick: 1, mapDeltas: { '210,500': w.T.D_MINE, '211,500': w.T.D_FARM } } } });
    expect(w.G.map[500][210]).toBe(w.T.D_MINE);
    expect(w.anyDesignation([w.T.D_MINE])).toBe(true);
    expect(w.anyDesignation([w.T.D_FARM])).toBe(true);
    expect(w.anyDesignation([w.T.D_ROAD])).toBe(false);
  });

  it('heals itself when the map is overwritten behind its back', () => {
    w.indexDesignation(42, 42, w.T.D_MINE);
    w.G.map[42][42] = w.T.D_MINE;
    expect(w.anyDesignation([w.T.D_MINE])).toBe(true);
    // Bypass every writer, the way a future code path might.
    w.G.map[42][42] = w.T.FLOOR;
    expect(w.anyDesignation([w.T.D_MINE])).toBe(false);
    expect(w.anyDesignation([w.T.D_MINE])).toBe(false);
  });

  it('moves a tile between designation types rather than counting it twice', () => {
    w.indexDesignation(43, 43, w.T.D_ROAD);
    w.G.map[43][43] = w.T.D_ROAD;
    expect(w.anyDesignation([w.T.D_ROAD])).toBe(true);
    w.indexDesignation(43, 43, w.T.D_UPGRADE);
    w.G.map[43][43] = w.T.D_UPGRADE;
    expect(w.anyDesignation([w.T.D_ROAD])).toBe(false);
    expect(w.anyDesignation([w.T.D_UPGRADE])).toBe(true);
  });
});

describe('aiIdle does not search for work that does not exist', () => {
  let w: Hooks;

  function idleDwarf(): any {
    const d = w.createDwarf(200, 500, 'test-city');
    d.state = 'idle';
    d.hunger = 90; d.energy = 90; d.happiness = 90;
    d._tickSlot = 0;
    d.carrying = 0;
    w.G.dwarves = [d];
    w.G.tick = 0;
    return d;
  }

  beforeEach(() => {
    w = loadWorker();
    // Ocean everywhere: nothing gatherable, no trees, no designations, so every scan misses.
    // This is the worst case the cap and the index exist to bound.
    w.setMap(Array.from({ length: w.MAP_H }, () => new Uint8Array(w.MAP_W).fill(w.T.OCEAN)));
    w.G.map[500][200] = w.T.PLAINS;
    w.setCities([{ id: 'test-city', name: 'Test', emoji: '🏙', mx: 200, my: 500, res: { food: 50, wood: 50, stone: 0, iron: 0, beds: 4 } }]);
    // Every probabilistic branch in aiIdle fires under its own threshold, and the highest is
    // 0.4. Pinning above all of them leaves only the unconditional scans, so the call count
    // below is the thing under test rather than a dice roll.
    w.setRandom(0.99);
  });

  it('runs exactly one bounded scan when nothing is designated', () => {
    const d = idleDwarf();
    w.resetBfsCalls();
    w.aiIdle(d);
    // The mine, road/upgrade and farm scans are all skipped by the index; the wood scan is
    // skipped because the city has wood. What remains is the gather scan, now capped at 2500
    // expansions instead of 30000. Before this change the same tick cost four full-cap misses.
    expect(w.countBfsCalls()).toBe(1);
  });

  it('bounds the gather scan rather than paying the full cap', () => {
    const d = idleDwarf();
    w.resetBfsCalls();
    w.aiIdle(d);
    // The only scan left on an empty map is the gather sweep, whose result was already
    // discarded past 30 tiles. It must ask for the small cap, not the default 30000.
    expect(w.bfsCaps()).toEqual([4000]);
  });

  it('bounds the tree scan when the city is short of wood', () => {
    const d = idleDwarf();
    w.getCities()[0].res.wood = 0;
    w.resetBfsCalls();
    w.aiIdle(d);
    expect(w.bfsCaps()).toEqual([8000, 4000]);
  });

  it('searches for a mine once one is designated within reach', () => {
    const d = idleDwarf();
    for (let x = 200; x <= 210; x++) w.G.map[500][x] = w.T.PLAINS;
    w.onmessage({ data: { type: 'designate', changes: [{ x: 210, y: 500, tile: w.T.D_MINE }] } });
    w.resetBfsCalls();
    w.aiIdle(d);
    expect(w.countBfsCalls()).toBeGreaterThan(1);
    expect(d.target?.type).toBe('mine');
  });

  it('searches for a farm once one is designated within reach', () => {
    const d = idleDwarf();
    for (let x = 200; x <= 210; x++) w.G.map[500][x] = w.T.PLAINS;
    w.onmessage({ data: { type: 'designate', changes: [{ x: 210, y: 500, tile: w.T.D_FARM }] } });
    w.resetBfsCalls();
    w.aiIdle(d);
    expect(w.countBfsCalls()).toBe(1);
    expect(d.target?.type).toBe('farm');
  });

  it('searches for a road once one is designated within reach', () => {
    const d = idleDwarf();
    for (let x = 200; x <= 210; x++) w.G.map[500][x] = w.T.PLAINS;
    w.onmessage({ data: { type: 'designate', changes: [{ x: 210, y: 500, tile: w.T.D_ROAD }] } });
    w.resetBfsCalls();
    w.aiIdle(d);
    expect(w.countBfsCalls()).toBe(1);
    expect(d.target?.type).toBe('road');
  });

  it('stops looking again after the designated work is completed', () => {
    const d = idleDwarf();
    for (let x = 200; x <= 210; x++) w.G.map[500][x] = w.T.PLAINS;
    w.onmessage({ data: { type: 'designate', changes: [{ x: 210, y: 500, tile: w.T.D_MINE }] } });
    w.mapSet(210, 500, w.T.FLOOR);
    const fresh = idleDwarf();
    w.resetBfsCalls();
    w.aiIdle(fresh);
    expect(w.countBfsCalls()).toBe(1);
  });
});

describe('rebuildRoadGraph', () => {
  let w: Hooks;

  beforeEach(() => {
    w = loadWorker();
    w.setMap(Array.from({ length: w.MAP_H }, () => new Uint8Array(w.MAP_W).fill(w.T.PLAINS)));
  });

  it('links two cities joined by a continuous road', () => {
    const row = 300;
    w.setCities([
      { id: 'alpha', name: 'Alpha', mx: 100, my: row, res: {} },
      { id: 'beta', name: 'Beta', mx: 130, my: row, res: {} },
    ]);
    w.G.map[row][100] = w.T.CITY;
    w.G.map[row][130] = w.T.CITY;
    for (let x = 101; x < 130; x++) w.G.map[row][x] = w.T.ROAD;
    w.rebuildRoadGraph();
    expect(w.G.roadGraph['alpha-beta']).toBeDefined();
    expect(w.G.roadGraph['alpha-beta'].gravel).toBe(true);
    expect(w.G.roadGraphDirty).toBe(false);
  });

  it('leaves unconnected cities unlinked', () => {
    const row = 300;
    w.setCities([
      { id: 'alpha', name: 'Alpha', mx: 100, my: row, res: {} },
      { id: 'beta', name: 'Beta', mx: 130, my: row, res: {} },
    ]);
    w.G.map[row][100] = w.T.CITY;
    w.G.map[row][130] = w.T.CITY;
    for (let x = 101; x < 120; x++) w.G.map[row][x] = w.T.ROAD;
    w.rebuildRoadGraph();
    expect(w.G.roadGraph['alpha-beta']).toBeUndefined();
  });

  it('does not record a tier the road never reaches', () => {
    const row = 300;
    w.setCities([
      { id: 'alpha', name: 'Alpha', mx: 100, my: row, res: {} },
      { id: 'beta', name: 'Beta', mx: 130, my: row, res: {} },
    ]);
    w.G.map[row][100] = w.T.CITY;
    w.G.map[row][130] = w.T.CITY;
    for (let x = 101; x < 130; x++) w.G.map[row][x] = w.T.PATH;
    w.rebuildRoadGraph();
    expect(w.G.roadGraph['alpha-beta'].path).toBe(true);
    expect(w.G.roadGraph['alpha-beta'].gravel).toBeUndefined();
  });

  it('picks up a city added after the previous rebuild', () => {
    const row = 300;
    const cities = [
      { id: 'alpha', name: 'Alpha', mx: 100, my: row, res: {} },
      { id: 'beta', name: 'Beta', mx: 130, my: row, res: {} },
    ];
    w.setCities(cities);
    w.G.map[row][100] = w.T.CITY;
    w.G.map[row][130] = w.T.CITY;
    for (let x = 101; x < 160; x++) w.G.map[row][x] = w.T.ROAD;
    w.rebuildRoadGraph();
    expect(w.G.roadGraph['beta-gamma']).toBeUndefined();

    // The position lookup is built per rebuild, so a colony founded mid-game must appear.
    cities.push({ id: 'gamma', name: 'Gamma', mx: 160, my: row, res: {} });
    w.G.map[row][160] = w.T.CITY;
    w.rebuildRoadGraph();
    expect(w.G.roadGraph['beta-gamma']).toBeDefined();
  });

  it('coalesces repeated dirty rebuilds instead of paying per road tile', () => {
    const row = 300;
    w.setCities([
      { id: 'alpha', name: 'Alpha', mx: 100, my: row, res: { food: 50 } },
      { id: 'beta', name: 'Beta', mx: 130, my: row, res: { food: 50 } },
    ]);
    w.G.map[row][100] = w.T.CITY;
    w.G.map[row][130] = w.T.CITY;
    for (let x = 101; x < 130; x++) w.G.map[row][x] = w.T.ASPHALT;

    const traveller = () => ({ id: 'd', name: 'D', cityId: 'alpha', x: 100, y: row, hunger: 100, energy: 100, eventLog: [], carryItems: {}, inventory: [] });

    w.G.roadGraph = {};
    w.G.roadGraphDirty = true;
    w.G.tick = 0;
    w.tryTravel(traveller());
    expect(w.G.roadGraphDirty).toBe(false);
    expect(w.G.roadGraphBuiltTick).toBe(0);

    // A dwarf laying road dirties the graph again a few ticks later. That must not buy another
    // full multi-tier scan; the previous graph is stale but still usable for ranking.
    w.G.roadGraphDirty = true;
    w.G.tick = 10;
    w.tryTravel(traveller());
    expect(w.G.roadGraphBuiltTick).toBe(0);
    expect(w.G.roadGraphDirty).toBe(true);

    // Once the cooldown has passed the next traveller does pay for a fresh graph.
    w.G.tick = 200;
    w.tryTravel(traveller());
    expect(w.G.roadGraphBuiltTick).toBe(200);
    expect(w.G.roadGraphDirty).toBe(false);
  });

  it('always builds when there is no graph at all, cooldown or not', () => {
    const row = 300;
    w.setCities([{ id: 'alpha', name: 'Alpha', mx: 100, my: row, res: { food: 50 } }]);
    w.G.map[row][100] = w.T.CITY;
    w.G.roadGraph = null;
    w.G.roadGraphDirty = false;
    w.G.tick = 5;
    w.tryTravel({ id: 'd', name: 'D', cityId: 'alpha', x: 100, y: row, hunger: 100, energy: 100, eventLog: [], carryItems: {}, inventory: [] });
    expect(w.G.roadGraph).toEqual({});
    expect(w.G.roadGraphBuiltTick).toBe(5);
  });

  it('marks itself dirty when a colony is founded', () => {
    // A new city is a new node. Founding used to push into CITIES without raising the flag, so
    // the colony stayed out of every road pair until some unrelated road tile dirtied it.
    const row = 300;
    w.setCities([{ id: 'alpha', name: 'Alpha', mx: 100, my: row, culture: 'american', res: { food: 50 } }]);
    w.G.map[row][100] = w.T.CITY;

    const founder = w.createDwarf(600, row, 'alpha');
    const partner = w.createDwarf(601, row, 'alpha');
    for (const d of [founder, partner]) {
      d.ambition = 99;
      d.state = 'idle';
      d.carryItems = { wood: 5 };
      d.carrying = w.carryCapacity(d);
    }
    w.G.dwarves = [founder, partner];
    w.G.roadGraphDirty = false;

    expect(w.tryFoundCity(founder)).toBe(true);
    expect(w.getCities().length).toBe(2);
    expect(w.G.roadGraphDirty).toBe(true);
  });

  it('drops a stale graph when a save is restored', () => {
    // G.tick jumps to the saved value on restore, possibly backwards. If the cooldown survived
    // that jump it would wait for a tick number already in the past, and the graph carried over
    // from the previous session describes a different map.
    const row = 300;
    w.setCities([{ id: 'alpha', name: 'Alpha', mx: 100, my: row, res: { food: 50 } }]);
    w.G.map[row][100] = w.T.CITY;
    w.rebuildRoadGraph();
    w.G.tick = 5000;
    w.G.roadGraphBuiltTick = 5000;
    w.G.roadGraph = { 'stale-pair': { gravel: true } };

    w.onmessage({ data: { type: 'restore', state: { tick: 10, mapDeltas: {} } } });

    expect(w.G.roadGraph).toBeNull();
    expect(w.G.roadGraphDirty).toBe(true);
    expect(w.G.roadGraphBuiltTick).toBeUndefined();
  });

  it('ignores cities that were never placed on the map', () => {
    const row = 300;
    w.setCities([
      { id: 'alpha', name: 'Alpha', mx: 100, my: row, res: {} },
      { id: 'ghost', name: 'Ghost', res: {} },
    ]);
    w.G.map[row][100] = w.T.CITY;
    expect(() => w.rebuildRoadGraph()).not.toThrow();
    expect(Object.keys(w.G.roadGraph)).toEqual([]);
  });
});
