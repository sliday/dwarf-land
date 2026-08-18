import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

/**
 * A real saved world measured 2,196,897 bytes against the server's 1,500,000 byte cap
 * (`MAX_STATE_BYTES` in src/db/state.ts), so a played-in world was rejected with 413 on every
 * save and simply stopped persisting. Where it went:
 *
 *   dwarves          1,102,683   of which eventLog alone was 869,670 (40% of the whole save)
 *   mapDeltas          900,223   71,250 entries at ~13 bytes as {"x,y":tile}
 *   animals            126,699
 *   everything else     67,292
 *
 * Two changes: per-dwarf history is capped at SAVED_EVENT_LOG entries, and mapDeltas is packed
 * to 4 bytes an entry and base64'd at the save boundary only. The in-memory shape is unchanged.
 *
 * These tests run the packer extracted from the shipped files and, where a real payload is
 * available on disk, measure against it rather than a fixture.
 */

const IDX = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const WRK = readFileSync(new URL('../public/game-worker.js', import.meta.url), 'utf8');

/** Load the shipped pack/unpack pair out of a file. */
function loadPacker(src: string, label: string) {
  const start = src.indexOf('function packMapDeltas(');
  if (start === -1) throw new Error(`packMapDeltas missing from ${label}`);
  const endMarker = 'const SAVED_EVENT_LOG';
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`SAVED_EVENT_LOG missing from ${label}`);
  const code = src.slice(start, end);
  expect(code).toContain('unpackMapDeltas');

  const ctx: Record<string, any> = {
    MAP_W: 2000, MAP_H: 1000, Uint8Array, String, Math, Object, console,
    btoa: (b: string) => Buffer.from(b, 'binary').toString('base64'),
    atob: (b: string) => Buffer.from(b, 'base64').toString('binary'),
  };
  createContext(ctx);
  runInContext(code + '\nglobalThis.__p = { packMapDeltas, unpackMapDeltas };', ctx);
  return ctx.__p as {
    packMapDeltas: (d: Record<string, number>) => string;
    unpackMapDeltas: (p: unknown) => Record<string, number>;
  };
}

/** The shipped event-log cap, read rather than restated. */
function eventLogCap(src: string, label: string): number {
  const m = src.match(/const SAVED_EVENT_LOG = (\d+);/);
  if (!m) throw new Error(`SAVED_EVENT_LOG missing from ${label}`);
  return Number(m[1]);
}

const worker = loadPacker(WRK, 'game-worker.js');
const page = loadPacker(IDX, 'index.html');

describe('map delta packing', () => {
  it('round-trips an ordinary set of deltas exactly', () => {
    const deltas: Record<string, number> = {};
    for (let i = 0; i < 500; i++) deltas[`${(i * 7) % 2000},${(i * 13) % 1000}`] = i % 41;
    expect(worker.unpackMapDeltas(worker.packMapDeltas(deltas))).toEqual(deltas);
  });

  it('round-trips the corners of the map', () => {
    const deltas = { '0,0': 1, '1999,0': 2, '0,999': 3, '1999,999': 4 };
    expect(worker.unpackMapDeltas(worker.packMapDeltas(deltas))).toEqual(deltas);
  });

  it('is far smaller than the object form', () => {
    const deltas: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) deltas[`${i % 2000},${Math.floor(i / 2000)}`] = i % 41;
    const objBytes = Buffer.byteLength(JSON.stringify(deltas));
    const packedBytes = Buffer.byteLength(JSON.stringify(worker.packMapDeltas(deltas)));
    expect(packedBytes).toBeLessThan(objBytes / 2);
  });

  it('accepts a save written before packing existed', () => {
    const legacy = { '10,20': 5, '30,40': 6 };
    expect(worker.unpackMapDeltas(legacy)).toEqual(legacy);
    expect(worker.unpackMapDeltas(undefined)).toEqual({});
    expect(worker.unpackMapDeltas(null)).toEqual({});
    expect(worker.unpackMapDeltas('')).toEqual({});
  });

  it('drops a coordinate that is off the map rather than corrupting its neighbours', () => {
    const deltas = { '5,5': 7, '99999,5': 8, '-1,5': 9 };
    const back = worker.unpackMapDeltas(worker.packMapDeltas(deltas));
    expect(back).toEqual({ '5,5': 7 });
  });

  it('both copies of the simulation pack identically', () => {
    const deltas: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) deltas[`${(i * 3) % 2000},${(i * 5) % 1000}`] = i % 41;
    expect(page.packMapDeltas(deltas)).toBe(worker.packMapDeltas(deltas));
  });
});

describe('the event log cap', () => {
  it('is set in both copies and agrees', () => {
    expect(eventLogCap(WRK, 'game-worker.js')).toBe(eventLogCap(IDX, 'index.html'));
  });

  it('is not zero, because slice(-0) keeps the whole array', () => {
    // This is not hypothetical: the model script used to size the change hit exactly this and
    // reported that trimming to zero saved nothing.
    expect(eventLogCap(WRK, 'game-worker.js')).toBeGreaterThan(0);
    const log = [1, 2, 3, 4, 5];
    expect(log.slice(-0)).toEqual(log);
  });

  it('keeps the log short enough to stop dominating the save', () => {
    expect(eventLogCap(WRK, 'game-worker.js')).toBeLessThanOrEqual(15);
  });
});

describe('a real saved world fits under the server cap', () => {
  const CAP = 1_500_000;
  const REAL = '/tmp/real-save.json';

  function realState(): any | null {
    try {
      return JSON.parse(readFileSync(REAL, 'utf8'));
    } catch {
      return null;
    }
  }

  it('the cap this is measured against is the one the server enforces', () => {
    const src = readFileSync(new URL('../src/db/state.ts', import.meta.url), 'utf8');
    const m = src.match(/MAX_STATE_BYTES\s*=\s*([0-9_]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ''))).toBe(CAP);
  });

  it.skipIf(!realState())('shrinks a payload that used to be rejected', () => {
    const state = realState()!;
    const before = Buffer.byteLength(JSON.stringify(state));
    expect(before).toBeGreaterThan(CAP); // the sample is only interesting if it failed

    const cap = eventLogCap(WRK, 'game-worker.js');
    const shrunk = { ...state };
    shrunk.dwarves = (state.dwarves || []).map((d: any) => ({
      ...d,
      eventLog: d.eventLog ? d.eventLog.slice(-cap) : d.eventLog,
    }));
    shrunk.mapDeltas = worker.packMapDeltas(state.mapDeltas || {});

    const after = Buffer.byteLength(JSON.stringify(shrunk));
    expect(after).toBeLessThan(CAP);
    // Headroom matters: the payload grows with play, so landing just under is not a fix.
    expect(after).toBeLessThan(CAP * 0.85);
    // And the deltas must survive the trip.
    expect(worker.unpackMapDeltas(shrunk.mapDeltas)).toEqual(state.mapDeltas);
  });
});
