import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';

/**
 * The save stores map DELTAS against the generated base map. While generation used unseeded
 * Math.random, the base world reshuffled every session: two runs of the shipped generator
 * differed on 33,891 tiles, 1.7% of the map. Iron a player had mined out reappeared somewhere
 * else, fish spots and mushrooms moved, and — worst of the lot — `G.homeCity` was picked at
 * random, relocating the whole starting fortress.
 *
 * There is one shared world here (a single game_state row, 125 real cities), so a fixed seed is
 * the entire fix; nothing needs to choose a seed per world.
 *
 * These tests run the shipped generator twice with real Math.random available, so a stray
 * unseeded call anywhere in the pipeline shows up as a difference rather than being masked by
 * a stubbed sandbox.
 */

const SRC = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const WRK = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');

function buildGenerator() {
  const L = SRC.split('\n');
  const grab = (sp: RegExp, ep: RegExp, drop = false) => {
    const s = L.findIndex((l) => sp.test(l));
    if (s === -1) throw new Error(`not found: ${sp}`);
    const e = L.findIndex((l, i) => i > s && ep.test(l));
    if (e === -1) throw new Error(`no end for: ${sp}`);
    const o = L.slice(s, e + 1);
    if (drop) o.pop();
    return o.join('\n');
  };
  // The seeding helpers sit immediately above generateMap and it calls them, so the extraction
  // has to start there or the generator has a dangling reference.
  const hs = L.findIndex((l) => /^\/\/ ---- Deterministic world generation ----/.test(l));
  if (hs === -1) throw new Error('seeding helpers not found in index.html');
  const gs = L.findIndex((l) => /^function generateMap\(\)/.test(l));
  const ps = L.findIndex((l) => /^  \/\/ Place cities/.test(l));
  if (gs === -1 || ps === -1) throw new Error('generateMap markers moved');

  const src = [
    grab(/^const MAP_W = /, /^const MAP_H = /),
    grab(/^const T = \{/, /^\};/),
    grab(/^const LAND = \[/, /^\];/),
    grab(/^function toLonLat\(/, /^function wrapY\(/),
    grab(/^function noise\(/, /^\/\/ ---- Land check ----/, true),
    grab(/^\/\/ ---- Land check ----/, /^\/\/ ---- Biome ----/, true),
    grab(/^function getBiome\(/, /^\}$/),
    'const G = { map: [] };',
    L.slice(hs, gs).join('\n'),
    `function gen() {\n${L.slice(gs + 1, ps).join('\n')}\n}`,
    'globalThis.__o = { gen, G, MAP_W, MAP_H, T, resetWorldRng, genRandom, WORLD_SEED };',
  ].join('\n\n');

  // Real Math, real Math.random. A stubbed sandbox would hide exactly the bug under test.
  const ctx: Record<string, any> = {
    console, Math, Uint8Array, Int32Array, Set, Map, Object, Array, Number, JSON,
  };
  createContext(ctx);
  runInContext(src, ctx);
  return ctx.__o;
}

function mapHash(w: any): string {
  const h = createHash('sha256');
  for (let y = 0; y < w.MAP_H; y++) h.update(w.G.map[y]);
  return h.digest('hex');
}

describe('world generation is reproducible', () => {
  let hashA: string;
  let hashB: string;
  let landSample = 0;

  beforeAll(() => {
    const a = buildGenerator();
    a.gen();
    hashA = mapHash(a);
    // Sampled here rather than in a test: a full generation takes about five seconds and the
    // default per-test timeout is five, so a third run times out rather than failing honestly.
    for (let y = 0; y < a.MAP_H; y += 7) {
      for (let x = 0; x < a.MAP_W; x += 7) if (a.G.map[y][x] !== a.T.OCEAN) landSample++;
    }
    const b = buildGenerator();
    b.gen();
    hashB = mapHash(b);
  }, 180_000);

  it('produces the identical world twice running', () => {
    expect(hashA).toBe(hashB);
  });

  it('produces a world at all, so the comparison is not of two empty maps', () => {
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(landSample).toBeGreaterThan(1000);
  });
});

describe('the generator no longer reaches for unseeded randomness', () => {
  function generateMapBody(): string {
    const start = SRC.indexOf('function generateMap() {');
    expect(start).toBeGreaterThan(-1);
    const open = SRC.indexOf('{', start);
    let depth = 0, end = -1;
    for (let i = open; i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    expect(end).toBeGreaterThan(-1);
    return SRC.slice(start, end + 1);
  }

  it('calls Math.random nowhere inside generateMap', () => {
    const body = generateMapBody();
    const strays = (body.match(/Math\.random\(\)/g) || []).length;
    expect(strays, 'generation randomness must go through genRandom so it can be seeded').toBe(0);
  });

  it('still uses seeded randomness in the places that need it', () => {
    // 22 sites when this landed: mushroom scatter, biome bleed, the resource overlay, and the
    // home-city pick. A drop to zero would mean the generator had silently stopped varying.
    const body = generateMapBody();
    expect((body.match(/genRandom\(\)/g) || []).length).toBeGreaterThanOrEqual(20);
  });

  it('leaves gameplay randomness alone', () => {
    // Dwarf creation, spawning and the AI are outside generation and must stay unseeded.
    expect((SRC.match(/Math\.random\(\)/g) || []).length).toBeGreaterThan(50);
  });

  it('reseeds at the top of generateMap, so a second call repeats the first', () => {
    expect(generateMapBody()).toMatch(/^function generateMap\(\) \{[\s\S]{0,200}resetWorldRng\(/);
  });
});

describe('the seed itself', () => {
  let gen: any;
  beforeAll(() => { gen = buildGenerator(); });

  it('gives the same sequence for the same seed', () => {
    gen.resetWorldRng(12345);
    const first = [gen.genRandom(), gen.genRandom(), gen.genRandom()];
    gen.resetWorldRng(12345);
    expect([gen.genRandom(), gen.genRandom(), gen.genRandom()]).toEqual(first);
  });

  it('gives a different sequence for a different seed', () => {
    gen.resetWorldRng(1);
    const a = [gen.genRandom(), gen.genRandom(), gen.genRandom()];
    gen.resetWorldRng(2);
    expect([gen.genRandom(), gen.genRandom(), gen.genRandom()]).not.toEqual(a);
  });

  it('stays inside the range callers assume of Math.random', () => {
    gen.resetWorldRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = gen.genRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is declared identically in both copies of the simulation', () => {
    const a = SRC.match(/const WORLD_SEED = (\d+);/);
    const b = WRK.match(/const WORLD_SEED = (\d+);/);
    expect(a, 'index.html has no WORLD_SEED').not.toBeNull();
    expect(b, 'game-worker.js has no WORLD_SEED').not.toBeNull();
    expect(a![1]).toBe(b![1]);
  });

  it('is written into the save so a load can tell which world the deltas belong to', () => {
    expect(SRC).toContain('worldSeed: WORLD_SEED');
    expect(WRK).toContain('worldSeed: WORLD_SEED');
    expect(SRC).toMatch(/saved\.worldSeed/);
  });
});
