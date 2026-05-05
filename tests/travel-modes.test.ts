import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const MAP_W = 500, MAP_H = 250;
const T = {
  OCEAN:0, TUNDRA:1, TAIGA:2, FOREST:3, PLAINS:4, DESERT:5, JUNGLE:6, MOUNTAIN:7,
  HILL:8, BEACH:9, FLOOR:10, WALL:11, STOCKPILE:12, BED:13, TABLE:14, DOOR:15,
  MUSHROOM:16, FARM:17, CITY:18, FISH_SPOT:23, CORAL:24,
  PATH:25, ROAD:26, ASPHALT:27, RAILROAD:28,
};

const TRAVEL_MODES: Record<string, {emoji:string, speed:number, cargoBonus:number, label:string, requires?:string}> = {
  walk:  { emoji:'\uD83D\uDEB6', speed:1,  cargoBonus:0,  label:'Walking' },
  cart:  { emoji:'\uD83D\uDC34', speed:2,  cargoBonus:8,  label:'Horse Cart',  requires:'path' },
  car:   { emoji:'\uD83D\uDE97', speed:4,  cargoBonus:15, label:'Car',          requires:'asphalt' },
  train: { emoji:'\uD83D\uDE82', speed:6,  cargoBonus:40, label:'Train',        requires:'railroad' },
  ship:  { emoji:'\u26F5',       speed:3,  cargoBonus:10, label:'Ship',         requires:'coastal' },
};

function wrapX(x: number) { return ((x % MAP_W) + MAP_W) % MAP_W; }
function isWater(x: number, y: number, map: number[][]) {
  const t = map[y]?.[wrapX(x)];
  return t === T.OCEAN || t === T.FISH_SPOT || t === T.CORAL;
}

function isCityCoastal(cx: number, cy: number, map: number[][]) {
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = wrapX(cx+dx), y = cy+dy;
      if (y >= 0 && y < MAP_H && isWater(x, y, map)) return true;
    }
  return false;
}

function bestTravelMode(
  originCity: {id:string, mx:number, my:number},
  destCity: {id:string, mx:number, my:number},
  roadGraph: Record<string, any>,
  map: number[][]
): string {
  const pairKey = [originCity.id, destCity.id].sort().join('-');
  const tiers = roadGraph[pairKey];
  if (tiers?.railroad) return 'train';
  if (tiers?.asphalt) return 'car';
  if (tiers?.gravel || tiers?.path) return 'cart';
  if (isCityCoastal(originCity.mx, originCity.my, map) &&
      isCityCoastal(destCity.mx, destCity.my, map)) return 'ship';
  return 'walk';
}

let map: number[][] = [];

function buildMap() {
  map = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      if (y <= 4) row.push(T.OCEAN);
      else row.push(T.PLAINS);
    }
    map.push(row);
  }
}

type WorkerHooks = {
  tryTravelTo: (d: any, city: any, dest: any) => boolean;
  tryTravel: (d: any) => boolean;
  rebuildRoadGraph: () => void;
  findVehicleRoute: (city: any, dest: any, minRoad: number) => Array<[number, number]> | null;
  tryShipPath: (city: any, dest: any) => Array<[number, number]> | null;
  bfs: (sx: number, sy: number, goalFn: (x: number, y: number) => boolean, walkToGoal: boolean) => Array<[number, number]> | null;
  bfsWater: (sx: number, sy: number, goalFn: (x: number, y: number) => boolean) => Array<[number, number]> | null;
  terrainCost: (x: number, y: number) => number;
  G: Record<string, any>;
  T: Record<string, number>;
  MAP_W: number;
  MAP_H: number;
  setCities: (cities: any[]) => void;
  setMap: (map: Uint8Array[]) => void;
};

function loadWorkerHooks(): WorkerHooks {
  const workerCode = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8') + `
self.__testHooks = {
  tryTravelTo,
  tryTravel,
  rebuildRoadGraph,
  findVehicleRoute,
  tryShipPath,
  bfs,
  bfsWater,
  terrainCost,
  G,
  T,
  MAP_W,
  MAP_H,
  setCities: (cities) => { CITIES = cities; },
  setMap: (map) => { G.map = map; },
};`;
  const context: Record<string, any> = {
    self: {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Uint8Array,
    console,
    Math,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  };
  createContext(context);
  runInContext(workerCode, context);
  return context.self.__testHooks as WorkerHooks;
}

function buildWorkerMap(worker: WorkerHooks, fill: number) {
  return Array.from({ length: worker.MAP_H }, () => new Uint8Array(worker.MAP_W).fill(fill));
}

beforeEach(() => buildMap());

describe('isCityCoastal', () => {
  it('returns true for city near water', () => {
    expect(isCityCoastal(10, 7, map)).toBe(true);
  });
  it('returns false for inland city', () => {
    expect(isCityCoastal(10, 50, map)).toBe(false);
  });
});

describe('bestTravelMode', () => {
  const cityA = { id:'a', mx:10, my:7 };
  const cityB = { id:'b', mx:50, my:7 };
  const cityC = { id:'c', mx:10, my:50 };
  const cityD = { id:'d', mx:50, my:50 };

  it('returns train when railroad exists', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{railroad:true,asphalt:true,gravel:true}}, map)).toBe('train');
  });
  it('returns car when asphalt exists but no railroad', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{asphalt:true,gravel:true}}, map)).toBe('car');
  });
  it('returns cart when gravel/path exists', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{gravel:true}}, map)).toBe('cart');
  });
  it('returns ship when both coastal and no road', () => {
    expect(bestTravelMode(cityA, cityB, {}, map)).toBe('ship');
  });
  it('returns walk when inland and no road', () => {
    expect(bestTravelMode(cityC, cityD, {}, map)).toBe('walk');
  });
  it('prefers land route over ship', () => {
    expect(bestTravelMode(cityA, cityB, {'a-b':{gravel:true}}, map)).toBe('cart');
  });
  it('returns cart for path tier', () => {
    expect(bestTravelMode(cityC, cityD, {'c-d':{path:true}}, map)).toBe('cart');
  });
});

describe('TRAVEL_MODES config', () => {
  it('has speed >= 1 for all modes', () => {
    for (const m of Object.values(TRAVEL_MODES)) expect(m.speed).toBeGreaterThanOrEqual(1);
  });
  it('walk has no requirements', () => {
    expect(TRAVEL_MODES.walk).not.toHaveProperty('requires');
  });
  it('each non-walk mode has a requires field', () => {
    for (const [k, m] of Object.entries(TRAVEL_MODES)) {
      if (k !== 'walk') expect(m).toHaveProperty('requires');
    }
  });
});

describe('travel mode on dwarf', () => {
  it('dwarf gains travelMode when traveling', () => {
    const d: any = { id:'d1', state:'idle', travelMode:null };
    d.travelMode = 'car';
    d.state = 'traveling';
    expect(d.travelMode).toBe('car');
    expect(TRAVEL_MODES.car.cargoBonus).toBe(15);
    expect(TRAVEL_MODES.car.speed).toBe(4);
  });
  it('dwarf clears travelMode on arrival', () => {
    const d: any = { state:'traveling', travelMode:'ship' };
    d.state = 'idle';
    d.travelMode = null;
    expect(d.travelMode).toBeNull();
  });
});

// Mode downshift: when preferred mode pathfind fails, fall back through chain.
// train -> car -> cart -> walk; ship -> walk if non-coastal.
const TRAVEL_DOWNSHIFT = ['train', 'car', 'cart', 'walk'];

function modeChain(preferred: string, isCoastalPair: boolean): string[] {
  if (preferred === 'ship') return isCoastalPair ? ['ship', 'walk'] : ['walk'];
  const idx = TRAVEL_DOWNSHIFT.indexOf(preferred);
  return TRAVEL_DOWNSHIFT.slice(idx >= 0 ? idx : TRAVEL_DOWNSHIFT.length - 1);
}

describe('travel mode downshift', () => {
  it('train downshifts through car, cart, walk', () => {
    expect(modeChain('train', false)).toEqual(['train', 'car', 'cart', 'walk']);
  });
  it('car downshifts through cart, walk', () => {
    expect(modeChain('car', false)).toEqual(['car', 'cart', 'walk']);
  });
  it('cart downshifts to walk', () => {
    expect(modeChain('cart', false)).toEqual(['cart', 'walk']);
  });
  it('walk has no downshift', () => {
    expect(modeChain('walk', false)).toEqual(['walk']);
  });
  it('ship downshifts to walk when coastal pair', () => {
    expect(modeChain('ship', true)).toEqual(['ship', 'walk']);
  });
  it('ship falls straight to walk when non-coastal', () => {
    expect(modeChain('ship', false)).toEqual(['walk']);
  });
});

describe('walk path cap', () => {
  // Live game runs MAP_W=2000. Cap of 200 blocked all cross-map walks.
  // New cap must accept at least 2000 tiles.
  const WALK_PATH_CAP = 2000;
  it('cap accepts paths up to 2000 tiles', () => {
    expect(WALK_PATH_CAP).toBeGreaterThanOrEqual(2000);
  });
  it('cap rejects paths over 2000 tiles', () => {
    const samplePath = new Array(2001);
    expect(samplePath.length > WALK_PATH_CAP).toBe(true);
  });
});

describe('inter-city connector range', () => {
  // Auto-connector previously gated at dist < 80 — too small for 2000-wide map.
  const CONNECTOR_MAX_DIST = 400;
  it('accepts pairs within 400 tiles', () => {
    expect(CONNECTOR_MAX_DIST).toBeGreaterThanOrEqual(400);
  });
});

describe('live worker travel continuity', () => {
  let worker: WorkerHooks;

  beforeEach(() => {
    worker = loadWorkerHooks();
  });

  it('does not call land goals outside vertical map bounds', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    worker.setMap(map);

    const path = worker.bfs(10, 0, (_x, y) => {
      if (y < 0 || y >= worker.MAP_H) throw new Error('out of bounds');
      return false;
    }, true);

    expect(path).toBeNull();
    expect(worker.terrainCost(10, -1)).toBe(Infinity);
    expect(worker.terrainCost(10, worker.MAP_H)).toBe(Infinity);
  });

  it('does not call water goals outside vertical map bounds', () => {
    const map = buildWorkerMap(worker, worker.T.OCEAN);
    worker.setMap(map);

    const path = worker.bfsWater(10, 0, (_x, y) => {
      if (y < 0 || y >= worker.MAP_H) throw new Error('out of bounds');
      return false;
    });

    expect(path).toBeNull();
  });

  it('walks back into the origin road network before vehicle travel from the field', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const cityA = { id:'a', name:'A', mx:100, my:100, res:{} };
    const cityB = { id:'b', name:'B', mx:120, my:100, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    for (let x = cityA.mx + 1; x < cityB.mx; x++) map[cityA.my][x] = worker.T.PATH;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = { 'a-b': { path:true } };
    const directRoute = worker.findVehicleRoute(cityA, cityB, worker.T.PATH);
    const dwarf: any = { id:'d', name:'D', x:100, y:103, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravelTo(dwarf, cityA, cityB)).toBe(true);
    expect(dwarf.travelMode).toBe('cart');
    expect(dwarf.path.slice(0, 4)).toEqual([[100, 102], [100, 101], [100, 100], [101, 100]]);
    expect(directRoute).not.toBeNull();
    expect(dwarf.path.slice(3)).toEqual(directRoute);
  });

  it('preserves the direct city-origin vehicle route', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const cityA = { id:'a', name:'A', mx:100, my:100, res:{} };
    const cityB = { id:'b', name:'B', mx:120, my:100, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    for (let x = cityA.mx + 1; x < cityB.mx; x++) map[cityA.my][x] = worker.T.PATH;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = { 'a-b': { path:true } };
    const directRoute = worker.findVehicleRoute(cityA, cityB, worker.T.PATH);
    const dwarf: any = { id:'d', name:'D', x:cityA.mx, y:cityA.my, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravelTo(dwarf, cityA, cityB)).toBe(true);
    expect(dwarf.travelMode).toBe('cart');
    expect(dwarf.path).toEqual(directRoute);
  });

  it('uses car on asphalt city routes', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const cityA = { id:'a', name:'A', mx:100, my:100, res:{} };
    const cityB = { id:'b', name:'B', mx:120, my:100, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    for (let x = cityA.mx + 1; x < cityB.mx; x++) map[cityA.my][x] = worker.T.ASPHALT;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = { 'a-b': { path:true, gravel:true, asphalt:true } };
    const directRoute = worker.findVehicleRoute(cityA, cityB, worker.T.ASPHALT);
    const dwarf: any = { id:'d', name:'D', x:cityA.mx, y:cityA.my, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravelTo(dwarf, cityA, cityB)).toBe(true);
    expect(dwarf.travelMode).toBe('car');
    expect(dwarf.path).toEqual(directRoute);
  });

  it('uses train on railroad city routes', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const cityA = { id:'a', name:'A', mx:100, my:100, res:{} };
    const cityB = { id:'b', name:'B', mx:120, my:100, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    for (let x = cityA.mx + 1; x < cityB.mx; x++) map[cityA.my][x] = worker.T.RAILROAD;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = { 'a-b': { path:true, gravel:true, asphalt:true, railroad:true } };
    const directRoute = worker.findVehicleRoute(cityA, cityB, worker.T.RAILROAD);
    const dwarf: any = { id:'d', name:'D', x:cityA.mx, y:cityA.my, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravelTo(dwarf, cityA, cityB)).toBe(true);
    expect(dwarf.travelMode).toBe('train');
    expect(dwarf.path).toEqual(directRoute);
  });

  it('rebuilds a dirty road graph before choosing travel mode', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const cityA = { id:'a', name:'A', mx:100, my:100, res:{} };
    const cityB = { id:'b', name:'B', mx:120, my:100, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    for (let x = cityA.mx + 1; x < cityB.mx; x++) map[cityA.my][x] = worker.T.ASPHALT;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = {};
    worker.G.roadGraphDirty = true;
    const dwarf: any = { id:'d', name:'D', cityId:'a', x:cityA.mx, y:cityA.my, hunger:100, energy:100, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravel(dwarf)).toBe(true);
    expect(worker.G.roadGraphDirty).toBe(false);
    expect(worker.G.roadGraph['a-b'].asphalt).toBe(true);
    expect(dwarf.travelMode).toBe('car');
  });

  it('prioritizes a farther railroad route over a nearby path route', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const cityA = { id:'a', name:'A', mx:100, my:100, res:{} };
    const cityB = { id:'b', name:'B', mx:104, my:110, res:{} };
    const cityC = { id:'c', name:'C', mx:150, my:100, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    map[cityC.my][cityC.mx] = worker.T.CITY;
    for (let y = cityA.my + 1; y < cityB.my; y++) map[y][cityA.mx] = worker.T.PATH;
    for (let x = cityA.mx + 1; x <= cityB.mx; x++) map[cityB.my][x] = worker.T.PATH;
    for (let x = cityA.mx + 1; x < cityC.mx; x++) map[cityA.my][x] = worker.T.RAILROAD;
    worker.setMap(map);
    worker.setCities([cityA, cityB, cityC]);
    worker.G.roadGraph = {
      'a-b': { path:true },
      'a-c': { path:true, gravel:true, asphalt:true, railroad:true },
    };
    const dwarf: any = { id:'d', name:'D', cityId:'a', x:cityA.mx, y:cityA.my, hunger:100, energy:100, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravel(dwarf)).toBe(true);
    expect(dwarf.target.destCityId).toBe('c');
    expect(dwarf.travelMode).toBe('train');
  });

  it('continues from the current route tile instead of returning to the origin city', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const cityA = { id:'a', name:'A', mx:100, my:100, res:{} };
    const cityB = { id:'b', name:'B', mx:120, my:100, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    for (let x = cityA.mx + 1; x < cityB.mx; x++) map[cityA.my][x] = worker.T.PATH;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = { 'a-b': { path:true } };
    const directRoute = worker.findVehicleRoute(cityA, cityB, worker.T.PATH);
    const dwarf: any = { id:'d', name:'D', x:105, y:100, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravelTo(dwarf, cityA, cityB)).toBe(true);
    expect(dwarf.travelMode).toBe('cart');
    expect(dwarf.path[0]).toEqual([106, 100]);
    expect(dwarf.path).not.toContainEqual([100, 100]);
    expect(directRoute).not.toBeNull();
    expect(dwarf.path).toEqual(directRoute!.slice(5));
  });

  it('walks to an embark tile before joining ship travel from the field', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    for (let y = 0; y <= 4; y++) map[y].fill(worker.T.OCEAN);
    const cityA = { id:'a', name:'A', mx:20, my:7, res:{} };
    const cityB = { id:'b', name:'B', mx:60, my:7, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = {};
    const shipRoute = worker.tryShipPath(cityA, cityB);
    const dwarf: any = { id:'d', name:'D', x:20, y:20, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravelTo(dwarf, cityA, cityB)).toBe(true);
    expect(dwarf.travelMode).toBe('ship');
    expect(dwarf.path[0]).toEqual([20, 19]);
    expect(dwarf.path).toContainEqual([20, 5]);
    const waterEntryIndex = dwarf.path.findIndex(([x, y]: [number, number]) => x === 20 && y === 4);
    expect(waterEntryIndex).toBeGreaterThan(0);
    expect(dwarf.path[waterEntryIndex - 1]).toEqual([20, 5]);
    expect(shipRoute).not.toBeNull();
    expect(dwarf.path.slice(waterEntryIndex + 1)).toEqual(shipRoute);
  });

  it('preserves the direct city-origin ship route', () => {
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    for (let y = 0; y <= 4; y++) map[y].fill(worker.T.OCEAN);
    const cityA = { id:'a', name:'A', mx:20, my:7, res:{} };
    const cityB = { id:'b', name:'B', mx:60, my:7, res:{} };
    map[cityA.my][cityA.mx] = worker.T.CITY;
    map[cityB.my][cityB.mx] = worker.T.CITY;
    worker.setMap(map);
    worker.setCities([cityA, cityB]);
    worker.G.roadGraph = {};
    const shipRoute = worker.tryShipPath(cityA, cityB);
    const dwarf: any = { id:'d', name:'D', x:cityA.mx, y:cityA.my, eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryTravelTo(dwarf, cityA, cityB)).toBe(true);
    expect(dwarf.travelMode).toBe('ship');
    expect(dwarf.path).toEqual(shipRoute);
  });
});
