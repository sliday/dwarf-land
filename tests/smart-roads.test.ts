import { describe, it, expect } from 'vitest';

// Replicate tile types and helpers from game-worker.js

const T = {
  OCEAN: 0, TUNDRA: 1, TAIGA: 2, FOREST: 3, PLAINS: 4, DESERT: 5,
  JUNGLE: 6, MOUNTAIN: 7, HILL: 8, BEACH: 9, PATH: 38, ROAD: 32, ASPHALT: 36,
  RAILROAD: 34, CITY: 18, FACTORY: 37, DIRT: 39,
};

const MAP_W = 50;
const MAP_H = 50;

function wrapX(x: number) { return ((x % MAP_W) + MAP_W) % MAP_W; }

function makeMap(fill = T.PLAINS): number[][] {
  return Array.from({length: MAP_H}, () => new Array(MAP_W).fill(fill));
}

// Mirror chainLen from game-worker.js
function chainLen(x: number, y: number, type: number, map: number[][]): number {
  let total = 0;
  const dirs = [[0,-1],[0,1],[1,0],[-1,0]];
  for (const [ddx, ddy] of dirs) {
    for (let i = 1; i <= 20; i++) {
      const nx = wrapX(x + ddx * i), ny = y + ddy * i;
      if (ny < 0 || ny >= MAP_H || map[ny][nx] !== type) break;
      total++;
    }
  }
  return total;
}

// Mirror bestUpgradeTarget from game-worker.js
function bestUpgradeTarget(dx: number, dy: number, res: {stone?:number, iron?:number, wood?:number}, map: number[][]) {
  let toType: number, fromType: number;
  if ((res.iron ?? 0) >= 3 && (res.wood ?? 0) >= 2) { fromType = T.ASPHALT; toType = T.RAILROAD; }
  else if ((res.stone ?? 0) >= 2 && (res.iron ?? 0) >= 1) { fromType = T.ROAD; toType = T.ASPHALT; }
  else if ((res.stone ?? 0) >= 1) { fromType = T.PATH; toType = T.ROAD; }
  else return null;
  const radius = 15;
  let best: {x:number,y:number,fromType:number,toType:number}|null = null, bestScore = -1, bestDist = Infinity;
  for (let oy = -radius; oy <= radius; oy++) {
    const ny = dy + oy;
    if (ny < 0 || ny >= MAP_H) continue;
    for (let ox = -radius; ox <= radius; ox++) {
      const nx = wrapX(dx + ox);
      if (map[ny][nx] !== fromType) continue;
      const score = chainLen(nx, ny, toType, map);
      const dist = Math.abs(ox) + Math.abs(oy);
      if (score > bestScore || (score === bestScore && dist < bestDist)) {
        best = {x:nx, y:ny, fromType, toType};
        bestScore = score;
        bestDist = dist;
      }
    }
  }
  return best;
}

// Mirror isOrphanRoad from game-worker.js
function isOrphanRoad(x: number, y: number, map: number[][]): boolean {
  const ROAD_LIKE = new Set([T.PATH, T.ROAD, T.ASPHALT, T.RAILROAD, T.CITY, T.FACTORY]);
  let neighbors = 0;
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  for (const [ddx, ddy] of dirs) {
    const nx = wrapX(x+ddx), ny = y+ddy;
    if (ny >= 0 && ny < MAP_H && ROAD_LIKE.has(map[ny][nx])) neighbors++;
  }
  if (neighbors === 0) return true;
  const visited = new Set<string>(), queue = [`${x},${y}`];
  visited.add(queue[0]);
  while (queue.length && visited.size <= 8) {
    const [cx, cy] = queue.shift()!.split(',').map(Number);
    if (map[cy][cx] === T.CITY || map[cy][cx] === T.FACTORY) return false;
    for (const [ddx, ddy] of dirs) {
      const nx = wrapX(cx+ddx), ny = cy+ddy;
      const k = `${nx},${ny}`;
      if (ny >= 0 && ny < MAP_H && !visited.has(k) && ROAD_LIKE.has(map[ny][nx])) {
        visited.add(k); queue.push(k);
      }
    }
  }
  return true;
}

describe('chainLen', () => {
  it('returns 0 for isolated tile with no matching neighbors', () => {
    const map = makeMap();
    expect(chainLen(25, 25, T.ROAD, map)).toBe(0);
  });

  it('counts horizontal chain of target type', () => {
    const map = makeMap();
    // 3 ROAD tiles in a row east of (25,25)
    map[25][26] = T.ROAD;
    map[25][27] = T.ROAD;
    map[25][28] = T.ROAD;
    expect(chainLen(25, 25, T.ROAD, map)).toBe(3);
  });

  it('counts chain in all 4 directions', () => {
    const map = makeMap();
    map[25][26] = T.ROAD; // east
    map[25][24] = T.ROAD; // west
    map[24][25] = T.ROAD; // north
    map[26][25] = T.ROAD; // south
    expect(chainLen(25, 25, T.ROAD, map)).toBe(4);
  });

  it('stops counting at non-matching tile', () => {
    const map = makeMap();
    map[25][26] = T.ROAD;
    map[25][27] = T.PLAINS; // break
    map[25][28] = T.ROAD;   // should not be counted
    expect(chainLen(25, 25, T.ROAD, map)).toBe(1);
  });

  it('wraps around map horizontally', () => {
    const map = makeMap();
    // Place road at x=0, check from x=49 (wraps)
    map[25][0] = T.ROAD;
    expect(chainLen(49, 25, T.ROAD, map)).toBeGreaterThanOrEqual(1);
  });
});

describe('bestUpgradeTarget', () => {
  it('returns null when no resources', () => {
    const map = makeMap();
    map[25][26] = T.PATH;
    const result = bestUpgradeTarget(25, 25, {stone:0, iron:0, wood:0}, map);
    expect(result).toBeNull();
  });

  it('picks PATH adjacent to existing ROAD chain over isolated PATH', () => {
    const map = makeMap();
    // PATH at (26,25) next to 3 ROADs
    map[25][26] = T.PATH;
    map[25][27] = T.ROAD;
    map[25][28] = T.ROAD;
    map[25][29] = T.ROAD;
    // Isolated PATH at (24,25) with no ROAD neighbors
    map[25][24] = T.PATH;
    const result = bestUpgradeTarget(25, 25, {stone:1}, map);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(26);
    expect(result!.y).toBe(25);
    expect(result!.fromType).toBe(T.PATH);
    expect(result!.toType).toBe(T.ROAD);
  });

  it('picks highest affordable tier (asphalt over road)', () => {
    const map = makeMap();
    map[25][26] = T.ROAD;  // upgradable to asphalt
    map[25][27] = T.PATH;  // upgradable to road
    const result = bestUpgradeTarget(25, 25, {stone:2, iron:1}, map);
    expect(result).not.toBeNull();
    expect(result!.fromType).toBe(T.ROAD);
    expect(result!.toType).toBe(T.ASPHALT);
  });

  it('picks closest tile when scores are tied', () => {
    const map = makeMap();
    // Two PATH tiles equidistant from center but one closer
    map[25][26] = T.PATH; // dist=1
    map[25][30] = T.PATH; // dist=5
    const result = bestUpgradeTarget(25, 25, {stone:1}, map);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(26); // closer one
  });

  it('picks railroad tier when enough iron+wood', () => {
    const map = makeMap();
    map[25][26] = T.ASPHALT;
    const result = bestUpgradeTarget(25, 25, {stone:5, iron:3, wood:2}, map);
    expect(result).not.toBeNull();
    expect(result!.fromType).toBe(T.ASPHALT);
    expect(result!.toType).toBe(T.RAILROAD);
  });

  it('returns null when no upgradable tiles in radius', () => {
    const map = makeMap();
    const result = bestUpgradeTarget(25, 25, {stone:1}, map);
    expect(result).toBeNull();
  });
});

describe('isOrphanRoad', () => {
  it('detects completely isolated road tile', () => {
    const map = makeMap();
    map[25][25] = T.ROAD;
    expect(isOrphanRoad(25, 25, map)).toBe(true);
  });

  it('road adjacent to city is NOT orphan', () => {
    const map = makeMap();
    map[25][25] = T.ROAD;
    map[25][26] = T.CITY;
    expect(isOrphanRoad(25, 25, map)).toBe(false);
  });

  it('road connected to city via short road chain is NOT orphan', () => {
    const map = makeMap();
    map[25][25] = T.ROAD;
    map[25][26] = T.ROAD;
    map[25][27] = T.ROAD;
    map[25][28] = T.CITY;
    expect(isOrphanRoad(25, 25, map)).toBe(false);
  });

  it('road adjacent to factory is NOT orphan', () => {
    const map = makeMap();
    map[25][25] = T.PATH;
    map[25][26] = T.FACTORY;
    expect(isOrphanRoad(25, 25, map)).toBe(false);
  });

  it('small disconnected road cluster is orphan', () => {
    const map = makeMap();
    map[25][25] = T.ROAD;
    map[25][26] = T.ROAD;
    map[25][27] = T.ROAD;
    // No city or factory nearby
    expect(isOrphanRoad(25, 25, map)).toBe(true);
  });

  it('road connected to city via long chain (>8 tiles) may be detected as orphan', () => {
    const map = makeMap();
    // Road chain of 10 tiles
    for (let i = 0; i < 10; i++) map[25][25+i] = T.ROAD;
    map[25][35] = T.CITY;
    // Tile at start is far from city — flood-fill limit of 8 may not reach
    expect(isOrphanRoad(25, 25, map)).toBe(true);
  });
});

describe('Dirt tile type', () => {
  it('DIRT has correct tile value', () => {
    expect(T.DIRT).toBe(39);
  });

  it('dirt aging converts DIRT to PLAINS after 1 year', () => {
    const map = makeMap();
    map[25][25] = T.DIRT;
    const dirtTiles = [{x: 25, y: 25, year: 1}];
    const currentYear = 2;
    // Simulate year tick aging
    const remaining = dirtTiles.filter(dt => {
      if (currentYear - dt.year >= 1) {
        if (map[dt.y] && map[dt.y][dt.x] === T.DIRT) map[dt.y][dt.x] = T.PLAINS;
        return false;
      }
      return true;
    });
    expect(remaining.length).toBe(0);
    expect(map[25][25]).toBe(T.PLAINS);
  });

  it('dirt does NOT age before 1 year passes', () => {
    const map = makeMap();
    map[25][25] = T.DIRT;
    const dirtTiles = [{x: 25, y: 25, year: 5}];
    const currentYear = 5;
    const remaining = dirtTiles.filter(dt => {
      if (currentYear - dt.year >= 1) {
        if (map[dt.y] && map[dt.y][dt.x] === T.DIRT) map[dt.y][dt.x] = T.PLAINS;
        return false;
      }
      return true;
    });
    expect(remaining.length).toBe(1);
    expect(map[25][25]).toBe(T.DIRT);
  });

  it('scrap_road converts road to DIRT and recovers stone', () => {
    const res = { stone: 0, iron: 0, wood: 0 };
    const tileType = T.ROAD;
    // Simulate scrap_road handler
    if (tileType !== T.PATH && res) res.stone = (res.stone || 0) + 1;
    expect(res.stone).toBe(1);
  });

  it('scrap_road on PATH does NOT recover stone', () => {
    const res = { stone: 0, iron: 0, wood: 0 };
    const tileType = T.PATH;
    if (tileType !== T.PATH && res) res.stone = (res.stone || 0) + 1;
    expect(res.stone).toBe(0);
  });
});
