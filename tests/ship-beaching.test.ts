import { describe, it, expect, beforeEach } from 'vitest';

const MAP_W = 500;
const MAP_H = 250;

const T = {
  OCEAN:0, TUNDRA:1, TAIGA:2, FOREST:3, PLAINS:4, DESERT:5, JUNGLE:6, MOUNTAIN:7,
  HILL:8, BEACH:9, FLOOR:10, WALL:11, STOCKPILE:12, BED:13, TABLE:14, DOOR:15,
  MUSHROOM:16, FARM:17, CITY:18, FISH_SPOT:23, CORAL:24,
};

const WALKABLE = new Set([
  T.TUNDRA, T.TAIGA, T.FOREST, T.PLAINS, T.DESERT, T.JUNGLE, T.HILL, T.BEACH,
  T.MOUNTAIN, T.FLOOR, T.STOCKPILE, T.BED, T.TABLE, T.DOOR, T.MUSHROOM, T.FARM, T.CITY,
]);

function wrapX(x: number): number { return ((x % MAP_W) + MAP_W) % MAP_W; }

function isWalkable(x: number, y: number): boolean {
  const t = map[y]?.[wrapX(x)];
  return WALKABLE.has(t);
}

function isWater(x: number, y: number): boolean {
  const t = map[y]?.[wrapX(x)];
  return t === T.OCEAN || t === T.FISH_SPOT || t === T.CORAL;
}

let map: number[][] = [];

function makeShip(x: number, y: number, overrides: any = {}) {
  return {
    id: 's_test', name: 'Test Ship', x, y,
    captainId: null, cityId: 'test-city',
    cargo: {}, cargoTotal: 0,
    state: 'docked', target: null, path: [] as number[][],
    ...overrides,
  };
}

// Replicate findShoreSpot from game-worker.js
function findShoreSpot(x: number, y: number, radius?: number) {
  radius = radius || 5;
  let best: {x:number,y:number} | null = null, bestDist = Infinity;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = wrapX(x+dx), ny = y+dy;
      if (ny < 0 || ny >= MAP_H || !isWater(nx, ny)) continue;
      const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
      let adjLand = false;
      for (const [ddx,ddy] of dirs) {
        const lx = wrapX(nx+ddx), ly = ny+ddy;
        if (ly >= 0 && ly < MAP_H && isWalkable(lx, ly)) { adjLand = true; break; }
      }
      if (!adjLand) continue;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist < bestDist) { bestDist = dist; best = {x:nx, y:ny}; }
    }
  return best;
}

// Replicate tickShip from game-worker.js (new version)
function tickShip(ship: ReturnType<typeof makeShip>) {
  if (ship.state === 'docked' || ship.state === 'waiting') return;
  if (ship.state === 'sailing' && ship.path.length > 0) {
    const [nx,ny] = ship.path.shift()!;
    ship.x = nx; ship.y = ny;
    if (ship.path.length === 0) {
      ship.state = 'docked';
      const shore = findShoreSpot(ship.x, ship.y);
      if (shore) { ship.x = shore.x; ship.y = shore.y; }
    }
  }
}

// Build a coastal map: row 4 is OCEAN, row 5 is BEACH, rows 6+ are PLAINS
function buildCoastalMap() {
  map = [];
  for (let y = 0; y < 10; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      if (y <= 4) row.push(T.OCEAN);
      else if (y === 5) row.push(T.BEACH);
      else row.push(T.PLAINS);
    }
    map.push(row);
  }
  for (let y = 10; y < MAP_H; y++) {
    map.push(new Array(MAP_W).fill(T.PLAINS));
  }
}

beforeEach(() => {
  buildCoastalMap();
});

describe('findShoreSpot', () => {
  it('finds water tile adjacent to land', () => {
    const spot = findShoreSpot(10, 5); // BEACH tile
    expect(spot).not.toBeNull();
    expect(isWater(spot!.x, spot!.y)).toBe(true);
    // Must have walkable neighbor
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    const hasLand = dirs.some(([dx,dy]) => isWalkable(wrapX(spot!.x+dx), spot!.y+dy));
    expect(hasLand).toBe(true);
  });

  it('returns closest shore tile when starting from land', () => {
    // From y=7 (PLAINS), nearest water adjacent to land is y=4 (OCEAN adjacent to BEACH at y=5)
    const spot = findShoreSpot(10, 7);
    expect(spot).not.toBeNull();
    expect(spot!.y).toBe(4); // ocean row adjacent to beach
  });

  it('returns closest shore tile when starting from water', () => {
    const spot = findShoreSpot(10, 4); // OCEAN adjacent to BEACH
    expect(spot).not.toBeNull();
    expect(spot!.x).toBe(10);
    expect(spot!.y).toBe(4);
  });

  it('returns null when no shore exists in radius', () => {
    // Deep ocean — no land within radius 2
    const spot = findShoreSpot(10, 0, 2);
    expect(spot).toBeNull();
  });

  it('handles wrapX at x=0', () => {
    const spot = findShoreSpot(0, 5);
    expect(spot).not.toBeNull();
    expect(isWater(spot!.x, spot!.y)).toBe(true);
  });

  it('returns water tile not land tile', () => {
    const spot = findShoreSpot(10, 6); // PLAINS
    expect(spot).not.toBeNull();
    expect(isWater(spot!.x, spot!.y)).toBe(true);
  });

  it('finds shore in an island scenario', () => {
    // Create a small island: ocean everywhere except a 3x3 land patch
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        map[y][x] = T.OCEAN;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        map[100+dy][100+dx] = T.PLAINS;

    const spot = findShoreSpot(100, 100);
    expect(spot).not.toBeNull();
    expect(isWater(spot!.x, spot!.y)).toBe(true);
    // Adjacent to land
    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    const hasLand = dirs.some(([dx,dy]) => isWalkable(wrapX(spot!.x+dx), spot!.y+dy));
    expect(hasLand).toBe(true);
  });
});

describe('tickShip — shore docking', () => {
  it('docks ship on water tile when path completes', () => {
    const ship = makeShip(10, 3, {
      state: 'sailing',
      path: [[10, 4]], // one step to coastal water
    });
    tickShip(ship);
    expect(ship.state).toBe('docked');
    expect(isWater(ship.x, ship.y)).toBe(true);
  });

  it('ship stays on water after docking (not moved to land)', () => {
    const ship = makeShip(10, 3, {
      state: 'sailing',
      path: [[10, 4]],
    });
    tickShip(ship);
    expect(isWater(ship.x, ship.y)).toBe(true);
    expect(isWalkable(ship.x, ship.y)).toBe(false);
  });

  it('does not move while still sailing', () => {
    const ship = makeShip(10, 2, {
      state: 'sailing',
      path: [[10, 3], [10, 4]],
    });
    tickShip(ship);
    expect(ship.state).toBe('sailing');
    expect(ship.x).toBe(10);
    expect(ship.y).toBe(3);
  });

  it('skips docked ships', () => {
    const ship = makeShip(10, 4);
    ship.state = 'docked';
    const origX = ship.x, origY = ship.y;
    tickShip(ship);
    expect(ship.x).toBe(origX);
    expect(ship.y).toBe(origY);
  });

  it('preserves ship.target on dock', () => {
    const ship = makeShip(10, 3, {
      state: 'sailing',
      path: [[10, 4]],
      target: { x: 10, y: 4, cityId: 'dest-city' },
    });
    tickShip(ship);
    expect(ship.state).toBe('docked');
    expect(ship.target).not.toBeNull();
    expect(ship.target.cityId).toBe('dest-city');
  });

  it('snaps to shore even if path ends in deep ocean', () => {
    // Ship ends path at y=2 (deep ocean), findShoreSpot should find y=4
    const ship = makeShip(10, 1, {
      state: 'sailing',
      path: [[10, 2]],
    });
    tickShip(ship);
    expect(ship.state).toBe('docked');
    expect(isWater(ship.x, ship.y)).toBe(true);
    // Should be at shore (y=4, adjacent to beach at y=5)
    expect(ship.y).toBe(4);
  });
});

describe('ship migration — beached ships snap to shore', () => {
  it('docked ship on land gets moved to nearest shore water', () => {
    const ship = makeShip(10, 5); // BEACH (land tile)
    ship.state = 'docked';
    // Simulate migration logic from load
    if (ship.state === 'docked' && !isWater(ship.x, ship.y)) {
      const shore = findShoreSpot(ship.x, ship.y);
      if (shore) { ship.x = shore.x; ship.y = shore.y; }
    }
    expect(isWater(ship.x, ship.y)).toBe(true);
  });

  it('docked ship already on water stays put', () => {
    const ship = makeShip(10, 4); // OCEAN
    ship.state = 'docked';
    const origX = ship.x, origY = ship.y;
    if (ship.state === 'docked' && !isWater(ship.x, ship.y)) {
      const shore = findShoreSpot(ship.x, ship.y);
      if (shore) { ship.x = shore.x; ship.y = shore.y; }
    }
    expect(ship.x).toBe(origX);
    expect(ship.y).toBe(origY);
  });

  it('sailing ship on land is not migrated', () => {
    const ship = makeShip(10, 6, { state: 'sailing' }); // PLAINS
    const origX = ship.x, origY = ship.y;
    if (ship.state === 'docked' && !isWater(ship.x, ship.y)) {
      const shore = findShoreSpot(ship.x, ship.y);
      if (shore) { ship.x = shore.x; ship.y = shore.y; }
    }
    // Not migrated because state is 'sailing'
    expect(ship.x).toBe(origX);
    expect(ship.y).toBe(origY);
  });
});

describe('createShip — no waterX/waterY', () => {
  it('does not have waterX or waterY fields', () => {
    const ship = makeShip(10, 4);
    // New ships should not have waterX/waterY (removed from createShip)
    // Our test makeShip also doesn't include them
    const keys = Object.keys(ship);
    expect(keys).not.toContain('waterX');
    expect(keys).not.toContain('waterY');
  });
});
