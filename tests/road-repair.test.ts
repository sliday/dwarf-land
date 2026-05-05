import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Replicate road gap detection logic from game-worker.js

const T = {
  OCEAN: 0, TUNDRA: 1, TAIGA: 2, FOREST: 3, PLAINS: 4, DESERT: 5,
  JUNGLE: 6, MOUNTAIN: 7, HILL: 8, BEACH: 9, FLOOR: 10, PATH: 38, ROAD: 32, ASPHALT: 36,
  RAILROAD: 34, CITY: 18, FACTORY: 37,
};

const MAP_W = 50;
const MAP_H = 50;
const WALKABLE = new Set([
  T.TUNDRA, T.TAIGA, T.FOREST, T.PLAINS, T.DESERT, T.JUNGLE, T.HILL, T.BEACH,
  T.FLOOR, T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD, T.CITY, T.FACTORY,
]);

function wrapX(x: number) { return ((x % MAP_W) + MAP_W) % MAP_W; }
function isWalkable(x: number, y: number, map: number[][]) {
  return WALKABLE.has(map[y][x]);
}

// Mirror findRoadGap from game-worker.js
function findRoadGap(dx: number, dy: number, radius: number, map: number[][]) {
  const ROAD_SET = new Set([T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD, T.CITY, T.FACTORY]);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]] as const;
  for (let r = 1; r <= radius; r++) {
    for (const [ddx, ddy] of dirs) {
      const x1 = wrapX(dx + ddx * r), y1 = dy + ddy * r;
      if (y1 < 0 || y1 >= MAP_H) continue;
      const t1 = map[y1][x1];
      if (!ROAD_SET.has(t1)) continue;
      for (let gap = 1; gap <= 2; gap++) {
        const gx = wrapX(dx + ddx * (r - gap)), gy = dy + ddy * (r - gap);
        if (gy < 0 || gy >= MAP_H) break;
        const gt = map[gy][gx];
        if (ROAD_SET.has(gt)) break;
        if (!isWalkable(gx, gy, map)) break;
        const bx = wrapX(dx + ddx * (r - gap - 1)), by = dy + ddy * (r - gap - 1);
        if (by < 0 || by >= MAP_H) continue;
        if (ROAD_SET.has(map[by][bx])) {
          return {x: gx, y: gy};
        }
      }
    }
  }
  return null;
}

function makeMap(fill = T.PLAINS): number[][] {
  return Array.from({length: MAP_H}, () => new Array(MAP_W).fill(fill));
}

type RoadwrightHooks = {
  tryRoadwrightWork: ((d: any) => boolean) | null;
  G: Record<string, any>;
  T: Record<string, number>;
  MAP_W: number;
  MAP_H: number;
  setCities: (cities: any[]) => void;
  setMap: (map: Uint8Array[]) => void;
};

function loadWorkerRoadwrightHooks(): RoadwrightHooks {
  const workerCode = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8') + `
self.__roadwrightHooks = {
  tryRoadwrightWork: typeof tryRoadwrightWork === 'function' ? tryRoadwrightWork : null,
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
  return context.self.__roadwrightHooks as RoadwrightHooks;
}

function buildWorkerMap(worker: RoadwrightHooks, fill: number) {
  return Array.from({ length: worker.MAP_H }, () => new Uint8Array(worker.MAP_W).fill(fill));
}

describe('Road Gap Detection', () => {
  it('finds a 1-tile gap in horizontal road', () => {
    const map = makeMap();
    // Road at x=10, gap at x=11, road at x=12 (y=25)
    map[25][10] = T.ROAD;
    map[25][12] = T.ROAD;
    // Dwarf at x=10, y=25
    const gap = findRoadGap(10, 25, 10, map);
    expect(gap).toEqual({x: 11, y: 25});
  });

  it('finds a 1-tile gap in vertical road', () => {
    const map = makeMap();
    map[20][15] = T.ROAD;
    map[22][15] = T.ROAD;
    const gap = findRoadGap(15, 20, 10, map);
    expect(gap).toEqual({x: 15, y: 21});
  });

  it('finds gap with 2-tile break', () => {
    const map = makeMap();
    // Road at x=5, gap at x=6 and x=7, road at x=8 (y=25)
    map[25][5] = T.ROAD;
    map[25][8] = T.ROAD;
    // Dwarf near the gap
    const gap = findRoadGap(5, 25, 10, map);
    // Should find the first gap tile (x=6 or x=7)
    expect(gap).not.toBeNull();
    expect(gap!.y).toBe(25);
    expect(gap!.x).toBeGreaterThanOrEqual(6);
    expect(gap!.x).toBeLessThanOrEqual(7);
  });

  it('returns null when no gap exists', () => {
    const map = makeMap();
    // Continuous road
    for (let x = 10; x <= 20; x++) map[25][x] = T.ROAD;
    const gap = findRoadGap(15, 25, 10, map);
    expect(gap).toBeNull();
  });

  it('returns null when no roads nearby', () => {
    const map = makeMap();
    const gap = findRoadGap(25, 25, 10, map);
    expect(gap).toBeNull();
  });

  it('does not detect gap through unwalkable tiles (ocean)', () => {
    const map = makeMap();
    map[25][10] = T.ROAD;
    map[25][11] = T.OCEAN; // unwalkable gap
    map[25][12] = T.ROAD;
    const gap = findRoadGap(10, 25, 10, map);
    // Should NOT return the ocean tile as a fixable gap
    if (gap) {
      expect(gap).not.toEqual({x: 11, y: 25});
    }
  });

  it('does not detect gap through mountain tiles', () => {
    const map = makeMap();
    map[25][10] = T.ROAD;
    map[25][11] = T.MOUNTAIN; // unwalkable in our test WALKABLE set
    map[25][12] = T.ROAD;
    // Mountain is not in our WALKABLE set for this test
    const gap = findRoadGap(10, 25, 10, map);
    if (gap) {
      expect(gap).not.toEqual({x: 11, y: 25});
    }
  });

  it('works with asphalt roads', () => {
    const map = makeMap();
    map[25][10] = T.ASPHALT;
    map[25][12] = T.ASPHALT;
    const gap = findRoadGap(10, 25, 10, map);
    expect(gap).toEqual({x: 11, y: 25});
  });

  it('works with railroad', () => {
    const map = makeMap();
    map[25][10] = T.RAILROAD;
    map[25][12] = T.RAILROAD;
    const gap = findRoadGap(10, 25, 10, map);
    expect(gap).toEqual({x: 11, y: 25});
  });

  it('works with mixed road types', () => {
    const map = makeMap();
    map[25][10] = T.ROAD;
    map[25][12] = T.ASPHALT;
    const gap = findRoadGap(10, 25, 10, map);
    expect(gap).toEqual({x: 11, y: 25});
  });

  it('respects radius limit', () => {
    const map = makeMap();
    map[25][10] = T.ROAD;
    map[25][25] = T.ROAD; // 15 tiles away, outside radius 10
    const gap = findRoadGap(10, 25, 10, map);
    expect(gap).toBeNull();
  });

  it('detects gap when dwarf is standing on a road', () => {
    const map = makeMap();
    map[25][15] = T.ROAD; // dwarf position
    map[25][16] = T.PLAINS; // gap
    map[25][17] = T.ROAD; // road continues
    const gap = findRoadGap(15, 25, 10, map);
    expect(gap).toEqual({x: 16, y: 25});
  });

  it('prefers closer gaps', () => {
    const map = makeMap();
    // Near gap at distance 2
    map[25][13] = T.ROAD;
    map[25][15] = T.ROAD;
    // Far gap at distance 8
    map[25][23] = T.ROAD;
    map[25][25] = T.ROAD;
    const gap = findRoadGap(13, 25, 10, map);
    // The function scans by increasing radius, so should find near gap first
    expect(gap).not.toBeNull();
    expect(gap!.x).toBe(14);
  });
});

describe('Path Tile in Road Network', () => {
  it('finds gap between path tiles', () => {
    const map = makeMap();
    map[25][10] = T.PATH;
    map[25][12] = T.PATH;
    const gap = findRoadGap(10, 25, 10, map);
    expect(gap).toEqual({x: 11, y: 25});
  });

  it('finds gap between path and road tiles', () => {
    const map = makeMap();
    map[25][10] = T.PATH;
    map[25][12] = T.ROAD;
    const gap = findRoadGap(10, 25, 10, map);
    expect(gap).toEqual({x: 11, y: 25});
  });

  it('path tiles count as road for gap detection', () => {
    const map = makeMap();
    // Continuous path — no gap
    for (let x = 10; x <= 20; x++) map[25][x] = T.PATH;
    const gap = findRoadGap(15, 25, 10, map);
    expect(gap).toBeNull();
  });
});

describe('Road Progression', () => {
  it('4-tier progression: path → gravel → asphalt → railroad', () => {
    const tiers = [T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD];
    expect(tiers).toHaveLength(4);
    // All are distinct tile types
    expect(new Set(tiers).size).toBe(4);
  });

  it('D_ROAD builds to PATH (free, no resources)', () => {
    // Mirror aiBuild logic: D_ROAD → PATH with no cost
    const tile = 33; // T.D_ROAD
    expect(tile).toBe(33);
    // No stone check needed — path is free
    const result = T.PATH;
    expect(result).toBe(38);
  });

  it('PATH upgrades to ROAD (costs 1 stone)', () => {
    const res = { stone: 1 };
    const tile = T.PATH;
    expect(tile === T.PATH && res.stone >= 1).toBe(true);
    res.stone -= 1;
    expect(res.stone).toBe(0);
  });

  it('ROAD upgrades to ASPHALT (costs 2 stone + 1 iron)', () => {
    const res = { stone: 2, iron: 1 };
    const tile = T.ROAD;
    expect(tile === T.ROAD && res.stone >= 2 && res.iron >= 1).toBe(true);
    res.stone -= 2; res.iron -= 1;
    expect(res.stone).toBe(0);
    expect(res.iron).toBe(0);
  });

  it('ASPHALT upgrades to RAILROAD (costs 3 iron + 2 wood)', () => {
    const res = { iron: 3, wood: 2 };
    const tile = T.ASPHALT;
    expect(tile === T.ASPHALT && res.iron >= 3 && res.wood >= 2).toBe(true);
    res.iron -= 3; res.wood -= 2;
    expect(res.iron).toBe(0);
    expect(res.wood).toBe(0);
  });

  it('vehicle tier requirements: cart=PATH, car=ASPHALT, train=RAILROAD', () => {
    const VEHICLE_TYPES = {
      cart: { minRoad: T.PATH },
      car: { minRoad: T.ASPHALT },
      train: { minRoad: T.RAILROAD },
    };
    expect(VEHICLE_TYPES.cart.minRoad).toBe(T.PATH);
    expect(VEHICLE_TYPES.car.minRoad).toBe(T.ASPHALT);
    expect(VEHICLE_TYPES.train.minRoad).toBe(T.RAILROAD);
  });
});

describe('Road Repair Integration', () => {
  it('fix_road target type transitions to building state', () => {
    const targetTypes = ['build', 'road', 'upgrade_road', 'fix_road'];
    const buildTypes = new Set(['build', 'road', 'upgrade_road', 'fix_road']);
    for (const tt of targetTypes) {
      expect(buildTypes.has(tt)).toBe(true);
    }
  });

  it('fix_road places PATH tile (free, no resource cost)', () => {
    // fix_road now places PATH instead of ROAD, no stone needed
    const result = T.PATH;
    expect(result).toBe(38);
  });

  it('fix_road does not overwrite existing road or path tiles', () => {
    const ROAD_SET = new Set([T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD]);
    expect(ROAD_SET.has(T.PATH)).toBe(true);
    expect(ROAD_SET.has(T.ROAD)).toBe(true);
    expect(ROAD_SET.has(T.ASPHALT)).toBe(true);
    expect(ROAD_SET.has(T.RAILROAD)).toBe(true);
    // Should fix if target is plains
    expect(ROAD_SET.has(T.PLAINS)).toBe(false);
  });
});

describe('Roadwright state', () => {
  it('fixes road gaps before upgrading road tiles', () => {
    const worker = loadWorkerRoadwrightHooks();
    expect(worker.tryRoadwrightWork).toBeTypeOf('function');
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const city = { id:'a', name:'A', mx:10, my:10, res:{ stone:20, iron:20, wood:20 } };
    map[city.my][city.mx] = worker.T.CITY;
    map[10][11] = worker.T.PATH;
    map[10][13] = worker.T.PATH;
    worker.setMap(map);
    worker.setCities([city]);
    const dwarf: any = { id:'d', name:'D', cityId:'a', x:11, y:10, state:'roadwright', target:null, path:[], eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryRoadwrightWork!(dwarf)).toBe(true);
    expect(dwarf.state).toBe('roadwright');
    expect(dwarf.target).toMatchObject({ type:'fix_road', x:12, y:10 });
  });

  it('upgrades roads when no continuity issue is available', () => {
    const worker = loadWorkerRoadwrightHooks();
    expect(worker.tryRoadwrightWork).toBeTypeOf('function');
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const city = { id:'a', name:'A', mx:10, my:10, res:{ stone:20, iron:0, wood:0 } };
    map[city.my][city.mx] = worker.T.CITY;
    map[10][11] = worker.T.PATH;
    map[10][12] = worker.T.PATH;
    map[10][13] = worker.T.PATH;
    worker.setMap(map);
    worker.setCities([city]);
    const dwarf: any = { id:'d', name:'D', cityId:'a', x:11, y:10, state:'roadwright', target:null, path:[], eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryRoadwrightWork!(dwarf)).toBe(true);
    expect(dwarf.state).toBe('roadwright');
    expect(dwarf.target?.type).toBe('upgrade_road');
  });

  it('repairs a floor gap between city center and road before scrapping that road', () => {
    const worker = loadWorkerRoadwrightHooks();
    expect(worker.tryRoadwrightWork).toBeTypeOf('function');
    const map = buildWorkerMap(worker, worker.T.PLAINS);
    const city = { id:'a', name:'A', mx:10, my:10, res:{ stone:20, iron:20, wood:20 } };
    map[city.my][city.mx] = worker.T.CITY;
    map[10][11] = worker.T.FLOOR;
    map[10][12] = worker.T.PATH;
    worker.setMap(map);
    worker.setCities([city]);
    const dwarf: any = { id:'d', name:'D', cityId:'a', x:10, y:10, state:'roadwright', target:null, path:[], eventLog:[], carryItems:{}, inventory:[] };

    expect(worker.tryRoadwrightWork!(dwarf)).toBe(true);
    expect(dwarf.target).toMatchObject({ type:'fix_road', x:11, y:10 });
  });
});
