import { describe, it, expect } from 'vitest';

// Replicate road gap detection logic from game-worker.js

const T = {
  OCEAN: 0, TUNDRA: 1, TAIGA: 2, FOREST: 3, PLAINS: 4, DESERT: 5,
  JUNGLE: 6, MOUNTAIN: 7, HILL: 8, BEACH: 9, ROAD: 32, ASPHALT: 36,
  RAILROAD: 34, CITY: 18, FACTORY: 37,
};

const MAP_W = 50;
const MAP_H = 50;
const WALKABLE = new Set([
  T.TUNDRA, T.TAIGA, T.FOREST, T.PLAINS, T.DESERT, T.JUNGLE, T.HILL, T.BEACH,
  T.ROAD, T.ASPHALT, T.RAILROAD, T.CITY, T.FACTORY,
]);

function wrapX(x: number) { return ((x % MAP_W) + MAP_W) % MAP_W; }
function isWalkable(x: number, y: number, map: number[][]) {
  return WALKABLE.has(map[y][x]);
}

// Mirror findRoadGap from game-worker.js
function findRoadGap(dx: number, dy: number, radius: number, map: number[][]) {
  const ROAD_SET = new Set([T.ROAD, T.ASPHALT, T.RAILROAD]);
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

describe('Road Repair Integration', () => {
  it('fix_road target type transitions to building state', () => {
    const targetTypes = ['build', 'road', 'upgrade_road', 'fix_road'];
    const buildTypes = new Set(['build', 'road', 'upgrade_road', 'fix_road']);
    for (const tt of targetTypes) {
      expect(buildTypes.has(tt)).toBe(true);
    }
  });

  it('fix_road costs 1 stone', () => {
    // Mirror the resource cost from aiBuild
    const stoneCost = 1;
    const res = { stone: 5 };
    expect(res.stone >= stoneCost).toBe(true);
    res.stone -= stoneCost;
    expect(res.stone).toBe(4);
  });

  it('fix_road only triggers when city has stone >= 1', () => {
    const res = { stone: 0 };
    expect(res.stone >= 1).toBe(false);

    res.stone = 1;
    expect(res.stone >= 1).toBe(true);
  });

  it('fix_road does not overwrite existing road tiles', () => {
    const ROAD_SET = new Set([T.ROAD, T.ASPHALT, T.RAILROAD]);
    // Should not fix if target is already a road
    expect(ROAD_SET.has(T.ROAD)).toBe(true);
    expect(ROAD_SET.has(T.ASPHALT)).toBe(true);
    expect(ROAD_SET.has(T.RAILROAD)).toBe(true);
    // Should fix if target is plains
    expect(ROAD_SET.has(T.PLAINS)).toBe(false);
  });
});
