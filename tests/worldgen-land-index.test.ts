import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * World generation runs synchronously in init() before the first paint, and it used to take
 * ~15.9s on the 2000x1000 map: isLandAt scanned all 91 continent ellipses on every call and
 * generateMap calls it five times per land tile, while prand recomputed the same lattice
 * corners millions of times.
 *
 * The optimisations are only acceptable because they are exact — the generated world must not
 * move by a single tile, since players' saves store deltas against it. These tests pin that:
 * the bucketed lookup must agree with a brute-force scan over every ellipse, and the memoised
 * prand must agree with the raw sine.
 *
 * The code under test is extracted verbatim from public/index.html, not re-implemented.
 */

type Gen = {
  isLandAt: (lon: number, lat: number) => boolean;
  bruteForceIsLandAt: (lon: number, lat: number) => boolean;
  prand: (x: number, y: number) => number;
  prandRaw: (x: number, y: number) => number;
  LAND: number[][];
  LAND_BUCKETS: number[][][];
  buildLandBuckets: (ellipses: number[][]) => number[][][];
  LAND_BUCKET_DEG: number;
  MAP_W: number;
  MAP_H: number;
  toLonLat: (mx: number, my: number) => [number, number];
};

function loadGen(): Gen {
  const lines = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').split('\n');
  const grab = (startPat: RegExp, endPat: RegExp, dropLast = false) => {
    const s = lines.findIndex((l) => startPat.test(l));
    if (s === -1) throw new Error(`not found: ${startPat}`);
    const e = lines.findIndex((l, i) => i > s && endPat.test(l));
    if (e === -1) throw new Error(`no end for: ${startPat}`);
    const out = lines.slice(s, e + 1);
    if (dropLast) out.pop();
    return out.join('\n');
  };

  const src = [
    grab(/^const MAP_W = /, /^const MAP_H = /),
    grab(/^const LAND = \[/, /^\];/),
    grab(/^function toLonLat\(/, /^function wrapY\(/),
    grab(/^function noise\(/, /^\/\/ ---- Land check ----/, true),
    grab(/^\/\/ ---- Land check ----/, /^\/\/ ---- Biome ----/, true),
    // The original linear scan, kept here as the oracle the fast path must match.
    `function bruteForceIsLandAt(lon, lat) {
      for (const [cx, cy, rx, ry] of LAND) {
        let dx = lon - cx;
        if (dx > 180) dx -= 360;
        if (dx < -180) dx += 360;
        const dy = lat - cy;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) return true;
      }
      return false;
    }`,
    `globalThis.__gen = { isLandAt, bruteForceIsLandAt, prand, prandRaw, LAND, LAND_BUCKETS, buildLandBuckets, LAND_BUCKET_DEG, MAP_W, MAP_H, toLonLat };`,
  ].join('\n\n');

  const ctx: Record<string, any> = { Math, Map, Set, Object, Array, Number, console };
  createContext(ctx);
  runInContext(src, ctx);
  return ctx.__gen as Gen;
}

describe('continent lookup', () => {
  let g: Gen;
  beforeAll(() => { g = loadGen(); });

  it('extracts the real ellipse table', () => {
    expect(g.LAND.length).toBeGreaterThan(80);
    for (const e of g.LAND) expect(e).toHaveLength(4);
  });

  it('files every ellipse into at least one bucket', () => {
    const filed = new Set(g.LAND_BUCKETS.flat());
    expect(filed.size).toBe(g.LAND.length);
  });

  it('files each ellipse into every bucket its longitude span touches', () => {
    // Checking the index by construction rather than by luck. Bucketing by ceil(rx / 5) alone
    // is one bucket short whenever an ellipse centre sits near the end of its bucket, and
    // whether the shipped table happens to trigger that is not something to rely on.
    const bucketOf = (lon: number) =>
      Math.floor(((((lon + 180) % 360) + 360) % 360) / 5) % g.LAND_BUCKETS.length;
    const missing: string[] = [];
    for (const ellipse of g.LAND) {
      const [cx, , rx] = ellipse;
      for (let off = -rx; off <= rx; off += rx / 200) {
        const b = bucketOf(cx + off);
        if (!g.LAND_BUCKETS[b].includes(ellipse as any)) {
          missing.push(`ellipse cx=${cx} rx=${rx} absent from bucket ${b} (lon ${(cx + off).toFixed(3)})`);
        }
      }
    }
    expect(missing.slice(0, 5)).toEqual([]);
  });

  it('covers every ellipse alignment, not just the ones the shipped table happens to use', () => {
    // The bucket span is ceil(rx / deg). This walks synthetic ellipses across every alignment
    // within a bucket and every radius the table plausibly grows into, asserting each is filed
    // under every bucket its longitude span touches. A span one bucket short would leave a
    // stripe of real continent reading as ocean.
    const deg = g.LAND_BUCKET_DEG;
    const gaps: string[] = [];
    for (let rx = 1; rx <= 30; rx += 1) {
      for (let step = 0; step < 8; step++) {
        for (const base of [-180, -90, -1, 0, 1, 90, 175]) {
          const cx = base + (step * deg) / 8;
          const ellipse = [cx, 0, rx, 5];
          const buckets = g.buildLandBuckets([ellipse]);
          const bucketOf = (lon: number) =>
            Math.floor(((((lon + 180) % 360) + 360) % 360) / deg) % buckets.length;
          for (let off = -rx; off <= rx; off += rx / 60) {
            if (!buckets[bucketOf(cx + off)].includes(ellipse as any)) {
              gaps.push(`cx=${cx.toFixed(3)} rx=${rx} lon=${(cx + off).toFixed(3)}`);
            }
          }
        }
      }
    }
    expect(gaps.slice(0, 5)).toEqual([]);
  });

  it('matches the brute-force scan on the full tile grid', () => {
    // Sampled across the whole map rather than all 2M tiles, so the suite stays fast while
    // still covering every latitude band and the full longitude wrap.
    let checked = 0;
    for (let my = 0; my < g.MAP_H; my += 3) {
      for (let mx = 0; mx < g.MAP_W; mx += 3) {
        const [lon, lat] = g.toLonLat(mx, my);
        expect(g.isLandAt(lon, lat)).toBe(g.bruteForceIsLandAt(lon, lat));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200000);
  });

  it('matches on the perturbed coordinates generateMap actually queries', () => {
    // generateMap warps the lookup by noise (cn up to about +-4) and probes +-2 degrees for
    // the coast test, so queries land well outside the plain tile grid, including past +-180.
    for (let lon = -190; lon <= 190; lon += 0.37) {
      for (let lat = -93; lat <= 93; lat += 1.7) {
        expect(g.isLandAt(lon, lat)).toBe(g.bruteForceIsLandAt(lon, lat));
      }
    }
  });

  it('agrees on ellipse boundaries, where quantisation would show up first', () => {
    // A rasterised bitmap would round these to a tile centre and flip some of them. Walking
    // the rim of every ellipse at sub-tile steps proves the fast path is not approximating.
    for (const [cx, cy, rx, ry] of g.LAND) {
      for (let t = 0; t < 64; t++) {
        const a = (t / 64) * Math.PI * 2;
        for (const scale of [0.999, 1.0, 1.001]) {
          const lon = cx + Math.cos(a) * rx * scale;
          const lat = cy + Math.sin(a) * ry * scale;
          expect(g.isLandAt(lon, lat)).toBe(g.bruteForceIsLandAt(lon, lat));
        }
      }
    }
  });

  it('handles the antimeridian wrap', () => {
    for (let lat = -80; lat <= 80; lat += 2) {
      for (const lon of [-180, -179.9, -180.5, 179.9, 180, 180.5, -360, 360]) {
        expect(g.isLandAt(lon, lat)).toBe(g.bruteForceIsLandAt(lon, lat));
      }
    }
  });
});

describe('prand memoisation', () => {
  let g: Gen;
  beforeAll(() => { g = loadGen(); });

  it('returns the raw sine value for cached lattice coordinates', () => {
    for (let x = -50; x <= 50; x += 1) {
      for (let y = -50; y <= 50; y += 1) {
        expect(g.prand(x, y)).toBe(g.prandRaw(x, y));
      }
    }
  });

  it('is stable across repeat calls', () => {
    for (let x = 0; x < 200; x++) {
      const first = g.prand(x, x * 3);
      expect(g.prand(x, x * 3)).toBe(first);
      expect(g.prand(x, x * 3)).toBe(g.prandRaw(x, x * 3));
    }
  });

  it('never collides two lattice cells onto one cache slot', () => {
    // The packed key must stay injective over the range world gen uses.
    const seen = new Map<number, string>();
    for (let x = -20; x <= 1500; x += 7) {
      for (let y = -20; y <= 1500; y += 11) {
        const v = g.prand(x, y);
        const raw = g.prandRaw(x, y);
        if (v !== raw) seen.set(x, `${x},${y}`);
      }
    }
    expect([...seen.values()]).toEqual([]);
  });

  it('falls back to the raw computation outside the packing range', () => {
    for (const [x, y] of [[-5000, 0], [0, -5000], [20000, 3], [3, 20000], [1e9, 1e9]]) {
      expect(g.prand(x, y)).toBe(g.prandRaw(x, y));
    }
  });

  it('does not let two out-of-range points share a cache slot', () => {
    // (x + 4096) * 16384 + (y + 4096) stops being injective once a coordinate leaves the
    // packing range: these two pairs produce the same key. Without the range guard the second
    // lookup would return the first one's value.
    const a: [number, number] = [-5000, 0];
    const b: [number, number] = [-5001, 16384];
    const keyA = (a[0] + 4096) * 16384 + (a[1] + 4096);
    const keyB = (b[0] + 4096) * 16384 + (b[1] + 4096);
    expect(keyA).toBe(keyB);
    expect(g.prandRaw(...a)).not.toBe(g.prandRaw(...b));
    expect(g.prand(...a)).toBe(g.prandRaw(...a));
    expect(g.prand(...b)).toBe(g.prandRaw(...b));
  });
});
