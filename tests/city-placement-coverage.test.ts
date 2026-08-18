import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * Nine of the 125 advertised cities used to land in open ocean and get dropped by a bare
 * `continue`, with no log and no counter: Cape Town, Manila, Jakarta, Miami, Kingston, Quito,
 * Accra, Dakar, Antananarivo. The README and the About copy both promise 125.
 *
 * This runs the real terrain generation and the real placement block out of public/index.html
 * and asserts every city ends up somewhere. It also pins the landmass structure, because the
 * cheap way to place a city is to draw an ellipse that welds two continents together, and a
 * land bridge between, say, Cuba and Florida changes where dwarves can walk and trade.
 *
 * Generation is slow (a few seconds), so the world is built once for the whole file.
 */

type World = {
  CITIES: any[];
  G: { map: Uint8Array[] };
  MAP_W: number;
  MAP_H: number;
  T: Record<string, number>;
  warnings: string[];
};

let w: World;
let componentOf: Int32Array;
let oceanDistance: Int32Array;

function buildWorld(): World {
  const lines = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').split('\n');
  const grab = (sp: RegExp, ep: RegExp, dropLast = false) => {
    const s = lines.findIndex((l) => sp.test(l));
    if (s === -1) throw new Error(`not found: ${sp}`);
    const e = lines.findIndex((l, i) => i > s && ep.test(l));
    if (e === -1) throw new Error(`no end for: ${sp}`);
    const out = lines.slice(s, e + 1);
    if (dropLast) out.pop();
    return out.join('\n');
  };

  // generateMap calls resetWorldRng, defined in the seeding helpers just above it, so the
  // extraction has to start there. It also makes this world reproducible, which is what lets
  // the thresholds below be exact numbers rather than ranges.
  const seedStart = lines.findIndex((l) => /^\/\/ ---- Deterministic world generation ----/.test(l));
  if (seedStart === -1) throw new Error('seeding helpers not found; update this harness');
  const genStart = lines.findIndex((l) => /^function generateMap\(\)/.test(l));
  const placeStart = lines.findIndex((l) => /^  \/\/ Place cities/.test(l));
  const roadStart = lines.findIndex((l) => /^  \/\/ Generate roads between nearby cities/.test(l));
  if (genStart < 0 || placeStart < 0 || roadStart < 0) {
    throw new Error('generateMap block markers moved; update this harness');
  }

  const warnings: string[] = [];
  const src = [
    grab(/^const MAP_W = /, /^const MAP_H = /),
    grab(/^const T = \{/, /^\};/),
    grab(/^const LAND = \[/, /^\];/),
    grab(/^const CITIES = \[/, /^\];/),
    grab(/^function toLonLat\(/, /^function wrapY\(/),
    grab(/^function noise\(/, /^\/\/ ---- Land check ----/, true),
    grab(/^\/\/ ---- Land check ----/, /^\/\/ ---- Biome ----/, true),
    grab(/^function getBiome\(/, /^\}/),
    `const G = { map: [], cam: { x: 0, y: 0 } };`,
    lines.slice(seedStart, genStart).join('\n'),
    // Only mx/my matter here; starting resources are a separate concern.
    `function biomeStartRes() { return {}; }`,
    `function generateTerrain() {\n${lines.slice(genStart + 1, placeStart).join('\n')}\n}`,
    `function placeCities() {\n${lines.slice(placeStart, roadStart).join('\n')}\n}`,
    `globalThis.__w = { generateTerrain, placeCities, G, CITIES, MAP_W, MAP_H, T };`,
  ].join('\n\n');

  const vmMath: any = Object.create(Math);
  let s = 12345;
  vmMath.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ctx: Record<string, any> = {
    Math: vmMath,
    Uint8Array, Int32Array, Set, Map, Object, Array, Number, JSON,
    console: { ...console, warn: (m: string) => warnings.push(String(m)) },
  };
  createContext(ctx);
  runInContext(src, ctx);
  const world = ctx.__w;
  world.generateTerrain();
  world.placeCities();
  world.warnings = warnings;
  return world;
}

/** 4-connected land components with x-wrap, so "are these one landmass" is answerable. */
function labelComponents(world: World): Int32Array {
  const { MAP_W, MAP_H, G, T } = world;
  const id = new Int32Array(MAP_W * MAP_H).fill(-1);
  const seen = new Uint8Array(MAP_W * MAP_H);
  const isLand = (x: number, y: number) => G.map[y][x] !== T.OCEAN;
  let n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (seen[y * MAP_W + x] || !isLand(x, y)) continue;
      const stack: [number, number][] = [[x, y]];
      seen[y * MAP_W + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        id[cy * MAP_W + cx] = n;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = ((cx + dx) % MAP_W + MAP_W) % MAP_W;
          const ny = cy + dy;
          if (ny < 0 || ny >= MAP_H) continue;
          if (seen[ny * MAP_W + nx] || !isLand(nx, ny)) continue;
          seen[ny * MAP_W + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      n++;
    }
  }
  return id;
}

/** Distance from every tile to the nearest ocean tile, by multi-source BFS from the sea. */
function distanceToOcean(world: World): Int32Array {
  const { MAP_W, MAP_H, G, T } = world;
  const dist = new Int32Array(MAP_W * MAP_H).fill(-1);
  const queue = new Int32Array(MAP_W * MAP_H);
  let head = 0, tail = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (G.map[y][x] === T.OCEAN) { dist[y * MAP_W + x] = 0; queue[tail++] = y * MAP_W + x; }
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const y = (i / MAP_W) | 0, x = i % MAP_W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = ((x + dx) % MAP_W + MAP_W) % MAP_W;
      const ny = y + dy;
      if (ny < 0 || ny >= MAP_H) continue;
      const j = ny * MAP_W + nx;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      queue[tail++] = j;
    }
  }
  return dist;
}

// One world for the whole file: generation takes several seconds, and the beach checks below
// need the same map the placement checks run against.
beforeAll(() => {
  w = buildWorld();
  componentOf = labelComponents(w);
  oceanDistance = distanceToOcean(w);
}, 120_000);

const comp = (id: string) => {
  const c = w.CITIES.find((x) => x.id === id);
  if (!c || c.mx === undefined) return -1;
  return componentOf[c.my * w.MAP_W + c.mx];
};

describe('every advertised city gets a home', () => {
  it('places all 125 cities', () => {
    const dropped = w.CITIES.filter((c) => c.mx === undefined).map((c) => c.id);
    expect(dropped).toEqual([]);
    expect(w.CITIES.length).toBe(125);
  });

  it('logs nothing, because nothing was dropped', () => {
    expect(w.warnings).toEqual([]);
  });

  it('names the nine that used to fall in the sea', () => {
    // Listed explicitly so a regression points straight at the ellipse that went missing.
    for (const id of ['cape-town', 'manila', 'jakarta', 'miami', 'kingston', 'quito', 'accra', 'dakar', 'antananarivo']) {
      const city = w.CITIES.find((c) => c.id === id);
      expect(city, `${id} is missing from CITIES`).toBeDefined();
      expect(city.mx, `${id} was dropped`).toBeDefined();
      expect(w.G.map[city.my][city.mx]).not.toBe(w.T.OCEAN);
    }
  });

  it('keeps every city on a tile that is genuinely land', () => {
    const inSea = w.CITIES.filter((c) => c.mx !== undefined && w.G.map[c.my][c.mx] === w.T.OCEAN);
    expect(inSea.map((c) => c.id)).toEqual([]);
  });
});

describe('the new landmasses did not weld the world together', () => {
  it('keeps islands off the mainland', () => {
    // Each pair is separate in the real world and must stay separate here, or dwarves gain a
    // walking route that should be a sea crossing.
    const pairs: [string, string][] = [
      ['kingston', 'havana'],
      ['kingston', 'mexico-city'],
      ['antananarivo', 'nairobi'],
      ['manila', 'beijing'],
      ['london', 'paris'],
    ];
    const welded = pairs.filter(([a, b]) => comp(a) === comp(b)).map(([a, b]) => `${a}+${b}`);
    expect(welded).toEqual([]);
  });

  it('keeps coastal additions attached to their continent', () => {
    // The opposite failure: an ellipse that misses its continent leaves the city marooned on a
    // one-city island with no road or trade route to anywhere.
    const pairs: [string, string][] = [
      ['miami', 'new-york'],
      ['cape-town', 'nairobi'],
      ['dakar', 'cairo'],
      ['accra', 'cairo'],
      ['quito', 'lima'],
    ];
    const detached = pairs.filter(([a, b]) => comp(a) !== comp(b)).map(([a, b]) => `${a}+${b}`);
    expect(detached).toEqual([]);
  });

  it('leaves each city on a landmass big enough to live on', () => {
    const sizes = new Map<number, number>();
    for (let i = 0; i < componentOf.length; i++) {
      const c = componentOf[i];
      if (c >= 0) sizes.set(c, (sizes.get(c) || 0) + 1);
    }
    const tiny = w.CITIES
      .filter((c) => c.mx !== undefined)
      .map((c) => ({ id: c.id, size: sizes.get(comp(c.id)) || 0 }))
      .filter((c) => c.size < 20);
    expect(tiny).toEqual([]);
  });
});

describe('beaches follow the coast rather than ringing the continent', () => {
  // The beach test asks "is there ocean within BEACH_PROBE degrees". At 0.18 degrees per tile
  // the original 2 degrees meant 11 tiles, which drew a belt averaging 6 tiles deep and
  // reaching 17 inland — the thick tan halo visible around every landmass.
  function beachDepths(): number[] {
    const out: number[] = [];
    for (let y = 0; y < w.MAP_H; y++) {
      for (let x = 0; x < w.MAP_W; x++) {
        if (w.G.map[y][x] === w.T.BEACH) out.push(oceanDistance[y * w.MAP_W + x]);
      }
    }
    return out;
  }

  it('keeps the average beach within a couple of tiles of the water', () => {
    const d = beachDepths();
    expect(d.length).toBeGreaterThan(1000);
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    expect(mean).toBeLessThan(2.5);
  });

  it('leaves almost no beach stranded inland', () => {
    const d = beachDepths();
    const deep = d.filter((v) => v >= 5).length;
    expect(deep / d.length).toBeLessThan(0.05);
  });

  it('never puts sand halfway across a continent', () => {
    const d = beachDepths();
    expect(Math.max(...d)).toBeLessThan(10);
  });

  it('still draws a broken coastline rather than a solid outline', () => {
    // The noise gate means not every coastal tile is sand. If every one were, the coast would
    // read as a drawn border instead of a beach.
    let coastal = 0, sandy = 0;
    for (let y = 0; y < w.MAP_H; y++) {
      for (let x = 0; x < w.MAP_W; x++) {
        if (w.G.map[y][x] === w.T.OCEAN) continue;
        if (oceanDistance[y * w.MAP_W + x] !== 1) continue;
        coastal++;
        if (w.G.map[y][x] === w.T.BEACH) sandy++;
      }
    }
    // Measured: 0.334 with the noise gate, 0.504 without it. The upper bound sits between the
    // two so that deleting the gate fails here rather than quietly drawing a solid sand outline.
    expect(coastal).toBeGreaterThan(1000);
    expect(sandy / coastal).toBeGreaterThan(0.2);
    expect(sandy / coastal).toBeLessThan(0.45);
  });
});

describe('named regions look like the places they are named after', () => {
  // Every regional override used to sit below a global altitude test that returned MOUNTAIN or
  // HILL first, so the overrides could only ever claim low ground. That is why the Great Plains
  // came out 36% hill despite an override returning nothing but plains and forest, and why
  // Australia — the flattest continent — came out half mountain. The altitude test now runs
  // after the regional block.
  function census(lonLo: number, lonHi: number, latLo: number, latHi: number) {
    const counts = new Map<number, number>();
    let land = 0;
    for (let y = 0; y < w.MAP_H; y++) {
      const lat = 90 - (y / w.MAP_H) * 180;
      if (lat < latLo || lat > latHi) continue;
      for (let x = 0; x < w.MAP_W; x++) {
        const lon = (x / w.MAP_W) * 360 - 180;
        if (lon < lonLo || lon > lonHi) continue;
        const t = w.G.map[y][x];
        if (t === w.T.OCEAN) continue;
        land++;
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return { land, pct: (tile: number) => ((counts.get(tile) || 0) / land) * 100 };
  }

  it('leaves Australia flat and dry instead of mountainous', () => {
    const c = census(113, 153, -39, -10);
    expect(c.land).toBeGreaterThan(5000);
    expect(c.pct(w.T.MOUNTAIN)).toBeLessThan(15);   // was 50.3
    expect(c.pct(w.T.DESERT)).toBeGreaterThan(20);  // the outback
  });

  it('keeps the Great Plains flat', () => {
    const c = census(-100, -90, 38, 48);
    expect(c.land).toBeGreaterThan(500);
    expect(c.pct(w.T.HILL)).toBeLessThan(10);       // was 36.2
    expect(c.pct(w.T.PLAINS)).toBeGreaterThan(70);
  });

  it('puts mountains in the Himalayas, with passes through them', () => {
    // MOUNTAIN is walkable but costs five times what plains cost, and it is not farmable, so a
    // range that is nothing but peaks is a toll booth with no food. An earlier attempt at 79.5%
    // mountain left the cities inside it with nothing to farm; the range is now mostly hill
    // with mountain peaks and valley floors. High ground overall is what makes it read as a
    // range.
    const c = census(75, 100, 27, 40);
    expect(c.land).toBeGreaterThan(2000);
    expect(c.pct(w.T.MOUNTAIN)).toBeGreaterThan(20); // was 0
    // Not 100% high ground: the box covers the Tarim Basin, which is desert, and the range
    // needs valley floors or any city inside it has nothing farmable within reach.
    expect(c.pct(w.T.MOUNTAIN) + c.pct(w.T.HILL)).toBeGreaterThan(50);
  });

  it('puts high ground along the Andes', () => {
    const c = census(-76, -68, -40, 0);
    expect(c.land).toBeGreaterThan(2000);
    expect(c.pct(w.T.MOUNTAIN) + c.pct(w.T.HILL)).toBeGreaterThan(70); // was ~0 mountain
  });

  it('does not put a desert in central Brazil', () => {
    const c = census(-60, -40, -25, -5);
    expect(c.land).toBeGreaterThan(2000);
    expect(c.pct(w.T.DESERT)).toBeLessThan(3);      // was 18.7
  });

  it('leaves the Sahara a desert with highlands in it', () => {
    // Guards the other direction: moving the altitude test must not flatten regions that were
    // relying on it for texture. Measured 77.3/16.7 before the move, 77.8/17.9 after.
    const c = census(-5, 30, 18, 30);
    expect(c.land).toBeGreaterThan(2000);
    expect(c.pct(w.T.DESERT)).toBeGreaterThan(60);
    expect(c.pct(w.T.HILL)).toBeGreaterThan(5);
  });
});

describe('cities have farmland to grow into', () => {
  // An earlier version of this file hand-wrote a WALKABLE set that left MOUNTAIN out, and
  // asserted no city was sealed behind impassable terrain. MOUNTAIN is in the shipped WALKABLE
  // set in both public/index.html and public/game-worker.js — it is slow (speed 5), not a wall
  // — so that invariant was measuring something the game does not do. It is exactly the
  // failure mode TODOS.md records for the rest of the suite: a test that re-implements a
  // constant instead of importing it, and drifts from the shipped value immediately.
  //
  // What does bite is farmland. `farmable` covers FLOOR, PLAINS, BEACH, DESERT and TUNDRA, so
  // a region that only ever emits JUNGLE, FOREST, HILL or MOUNTAIN leaves the cities inside it
  // with nowhere to grow food. The set below is read out of the shipped source rather than
  // retyped here.
  function shippedFarmable(): Set<number> {
    const src = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const m = src.match(/const farmable = new Set\(\[([^\]]*)\]\)/);
    if (!m) throw new Error('farmable set not found in index.html; update this test');
    const names = [...m[1].matchAll(/T\.([A-Z_0-9]+)/g)].map((x) => x[1]);
    expect(names.length).toBeGreaterThan(3);
    return new Set(names.map((n) => w.T[n]));
  }

  /** Farmable tiles within `radius`, ignoring the 3x3 fortress the city writes itself. */
  function capacity(city: any, farmable: Set<number>, radius: number) {
    let n = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
        const x = ((city.mx + dx) % w.MAP_W + w.MAP_W) % w.MAP_W;
        const y = city.my + dy;
        if (y < 0 || y >= w.MAP_H) continue;
        if (farmable.has(w.G.map[y][x])) n++;
      }
    }
    return n;
  }

  it('reads the farmable set out of the shipped source', () => {
    const farmable = shippedFarmable();
    expect(farmable.has(w.T.PLAINS)).toBe(true);
    expect(farmable.has(w.T.JUNGLE)).toBe(false);
    expect(farmable.has(w.T.MOUNTAIN)).toBe(false);
  });

  it('leaves few cities with no farmland at all', () => {
    // Measured: 5 cities at zero on the original map, 6 after the biome regions landed, 4 once
    // the rainforest, Pacific North West and tropical rules gained a farmable outcome. The
    // bound tracks the measurement rather than aspiring to zero, because four remain.
    const farmable = shippedFarmable();
    const starved = w.CITIES
      .filter((c) => c.mx !== undefined)
      .filter((c) => capacity(c, farmable, 20) === 0)
      .map((c) => c.id);
    expect(starved.length, `no farmland near: ${starved.join(', ')}`).toBeLessThanOrEqual(4);
  });

  it('does not leave a long tail of near-starved cities', () => {
    const farmable = shippedFarmable();
    const thin = w.CITIES
      .filter((c) => c.mx !== undefined)
      .filter((c) => capacity(c, farmable, 20) < 20)
      .map((c) => c.id);
    // Measured by reverting each change on its own: 9 without the Pacific North West valleys,
    // 7 without the rainforest clearings, 6 with both. The bound sits at the measured value so
    // that dropping either one fails here.
    expect(thin.length, `under 20 farmable tiles: ${thin.join(', ')}`).toBeLessThanOrEqual(6);
  });

  it('keeps mountains passable rather than turning them into walls', () => {
    // Pins the fact the earlier invariant got wrong, so it cannot be silently reintroduced.
    const src = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    const m = src.match(/const WALKABLE = new Set\(\[([\s\S]*?)\]\)/);
    expect(m).not.toBeNull();
    const names = [...m![1].matchAll(/T\.([A-Z_0-9]+)/g)].map((x) => x[1]);
    expect(names).toContain('MOUNTAIN');
  });
});
