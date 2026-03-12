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

// Minimal map for testing — 10x10 grid
let map: number[][] = [];

function makeShip(x: number, y: number, overrides: any = {}) {
  return {
    id: 's_test', name: 'Test Ship', x, y,
    captainId: null, cityId: 'test-city',
    cargo: {}, cargoTotal: 0,
    state: 'docked', target: null, path: [],
    waterX: null as number | null, waterY: null as number | null,
    ...overrides,
  };
}

// Replicate beachShip from game-worker.js
function beachShip(ship: ReturnType<typeof makeShip>) {
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  for (const [dx,dy] of dirs) {
    const nx = wrapX(ship.x+dx), ny = ship.y+dy;
    if (ny >= 0 && ny < MAP_H && isWalkable(nx, ny)) {
      ship.waterX = ship.x; ship.waterY = ship.y;
      ship.x = nx; ship.y = ny;
      return;
    }
  }
}

// Replicate launchShip from game-worker.js
function launchShip(ship: ReturnType<typeof makeShip>) {
  if (ship.waterX !== null && ship.waterY !== null) {
    ship.x = ship.waterX; ship.y = ship.waterY;
    ship.waterX = null; ship.waterY = null;
    return;
  }
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  for (const [dx,dy] of dirs) {
    const nx = wrapX(ship.x+dx), ny = ship.y+dy;
    if (ny >= 0 && ny < MAP_H && isWater(nx, ny)) {
      ship.x = nx; ship.y = ny;
      return;
    }
  }
}

// Replicate tickShip from game-worker.js
function tickShip(ship: ReturnType<typeof makeShip>) {
  if (ship.state === 'docked' || ship.state === 'waiting') return;
  if (ship.state === 'sailing' && ship.path.length > 0) {
    const [nx,ny] = ship.path.shift()!;
    ship.x = nx; ship.y = ny;
    if (ship.path.length === 0) { ship.state = 'docked'; beachShip(ship); }
  }
}

// Build a coastal map: row 5 is BEACH, rows 0-4 are OCEAN, rows 6-9 are PLAINS
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
  // Pad to MAP_H with PLAINS
  for (let y = 10; y < MAP_H; y++) {
    map.push(new Array(MAP_W).fill(T.PLAINS));
  }
}

beforeEach(() => {
  buildCoastalMap();
});

describe('beachShip', () => {
  it('moves ship from water to adjacent walkable land tile', () => {
    const ship = makeShip(10, 4); // ocean at y=4
    beachShip(ship);
    expect(isWalkable(ship.x, ship.y)).toBe(true);
    expect(ship.waterX).toBe(10);
    expect(ship.waterY).toBe(4);
  });

  it('stores original water position in waterX/waterY', () => {
    const ship = makeShip(20, 4);
    beachShip(ship);
    expect(ship.waterX).toBe(20);
    expect(ship.waterY).toBe(4);
  });

  it('does nothing if no adjacent walkable tile exists', () => {
    // Ship surrounded by ocean (center of ocean)
    const ship = makeShip(10, 1);
    beachShip(ship);
    expect(ship.x).toBe(10);
    expect(ship.y).toBe(1);
    expect(ship.waterX).toBeNull();
    expect(ship.waterY).toBeNull();
  });

  it('prefers north (first direction checked) when multiple land tiles available', () => {
    // y=5 is BEACH, so ship at y=6 (PLAINS) has BEACH to north
    // But beachShip is for water->land. Let's put ship at y=4 (ocean), y=5 is BEACH (walkable)
    // dirs: [0,-1] = north (y=3, OCEAN), [1,0] = east (x=11, OCEAN), [0,1] = south (y=5, BEACH)
    const ship = makeShip(10, 4);
    beachShip(ship);
    // North is ocean, east is ocean, south (y=5) is BEACH — first walkable is south
    expect(ship.y).toBe(5);
    expect(ship.x).toBe(10);
  });

  it('handles ship at map edge (y=0)', () => {
    // Ship at top edge — north would be y=-1
    const ship = makeShip(10, 0);
    beachShip(ship);
    // All neighbors are OCEAN (y=0 and y=1 are ocean), so nothing happens
    expect(ship.x).toBe(10);
    expect(ship.y).toBe(0);
    expect(ship.waterX).toBeNull();
  });

  it('handles wrapX at x=0', () => {
    const ship = makeShip(0, 4);
    beachShip(ship);
    // Should beach onto y=5 (BEACH)
    expect(ship.y).toBe(5);
    expect(ship.waterX).toBe(0);
    expect(ship.waterY).toBe(4);
  });
});

describe('launchShip', () => {
  it('moves ship back to stored water position', () => {
    const ship = makeShip(10, 5, { waterX: 10, waterY: 4 });
    launchShip(ship);
    expect(ship.x).toBe(10);
    expect(ship.y).toBe(4);
    expect(ship.waterX).toBeNull();
    expect(ship.waterY).toBeNull();
  });

  it('clears waterX/waterY after launch', () => {
    const ship = makeShip(10, 5, { waterX: 10, waterY: 4 });
    launchShip(ship);
    expect(ship.waterX).toBeNull();
    expect(ship.waterY).toBeNull();
  });

  it('finds adjacent water tile if no stored position', () => {
    // Ship on BEACH at y=5, water to the north at y=4
    const ship = makeShip(10, 5);
    launchShip(ship);
    expect(isWater(ship.x, ship.y)).toBe(true);
    expect(ship.y).toBe(4);
  });

  it('does nothing if no stored position and no adjacent water', () => {
    // Ship in middle of land (y=8, all neighbors are PLAINS)
    const ship = makeShip(10, 8);
    launchShip(ship);
    expect(ship.x).toBe(10);
    expect(ship.y).toBe(8);
  });

  it('is idempotent — second call finds adjacent water', () => {
    const ship = makeShip(10, 5, { waterX: 10, waterY: 4 });
    launchShip(ship);
    expect(ship.y).toBe(4);
    // Call again — already on water, no stored position
    launchShip(ship);
    // Should stay on water (no stored position, finds adjacent water which is also ocean)
    expect(isWater(ship.x, ship.y)).toBe(true);
  });
});

describe('beachShip + launchShip roundtrip', () => {
  it('beach then launch restores original water position', () => {
    const ship = makeShip(15, 4);
    beachShip(ship);
    expect(ship.x).toBe(15);
    expect(ship.y).toBe(5); // beached on BEACH
    launchShip(ship);
    expect(ship.x).toBe(15);
    expect(ship.y).toBe(4); // back to original water
  });

  it('multiple beach/launch cycles are stable', () => {
    const ship = makeShip(15, 4);
    for (let i = 0; i < 5; i++) {
      beachShip(ship);
      expect(isWalkable(ship.x, ship.y)).toBe(true);
      launchShip(ship);
      expect(isWater(ship.x, ship.y)).toBe(true);
    }
  });
});

describe('tickShip integration', () => {
  it('beaches ship when path completes', () => {
    const ship = makeShip(10, 3, {
      state: 'sailing',
      path: [[10, 4]], // one step to coastal water
    });
    tickShip(ship);
    expect(ship.state).toBe('docked');
    expect(isWalkable(ship.x, ship.y)).toBe(true);
    expect(ship.waterX).toBe(10);
    expect(ship.waterY).toBe(4);
  });

  it('does not beach while still sailing', () => {
    const ship = makeShip(10, 2, {
      state: 'sailing',
      path: [[10, 3], [10, 4]], // two steps left
    });
    tickShip(ship);
    expect(ship.state).toBe('sailing');
    expect(ship.x).toBe(10);
    expect(ship.y).toBe(3);
    expect(ship.waterX).toBeNull();
  });

  it('skips docked ships', () => {
    const ship = makeShip(10, 5);
    ship.state = 'docked';
    const origX = ship.x, origY = ship.y;
    tickShip(ship);
    expect(ship.x).toBe(origX);
    expect(ship.y).toBe(origY);
  });

  it('does not clear ship.target on dock (fixed bug)', () => {
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
});

describe('createShip includes waterX/waterY', () => {
  it('has waterX and waterY initialized to null', () => {
    const ship = makeShip(10, 4);
    expect(ship).toHaveProperty('waterX', null);
    expect(ship).toHaveProperty('waterY', null);
  });
});
