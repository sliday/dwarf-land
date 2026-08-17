import { beforeEach, describe, expect, it } from 'vitest';
import {
  saveState,
  loadState,
  MAX_STATE_BYTES,
  StateTooLargeError,
  StateCorruptError,
} from '../src/db/state';
import type { GameState } from '../src/shared/types';

/**
 * src/db/state.ts had no tests at all, which is how the live world grew past D1's
 * 2,000,000-byte row limit unnoticed and stopped saving on 2026-07-26.
 */

type Statement = { sql: string; args: any[] };

class MockDB {
  statements: Statement[] = [];
  row: { state: string } | null = null;
  /** Set to throw on the next write, standing in for a D1 rejection. */
  failWrites = false;

  prepare(sql: string) {
    const record = (args: any[]) => {
      this.statements.push({ sql, args });
      if (this.failWrites && /INSERT|UPDATE/i.test(sql)) throw new Error('D1_ERROR: write rejected');
    };
    return {
      first: async () => { record([]); return this.readFirst(sql); },
      run: async () => { record([]); return this.applyRun(sql, []); },
      bind: (...args: any[]) => ({
        first: async () => { record(args); return this.readFirst(sql); },
        run: async () => { record(args); return this.applyRun(sql, args); },
      }),
    };
  }

  private readFirst(sql: string) {
    if (sql.includes('SELECT state FROM game_state')) return this.row;
    return null;
  }

  private applyRun(sql: string, args: any[]) {
    if (sql.includes('INSERT INTO game_state')) this.row = { state: args[0] };
    return {};
  }
}

const db = () => new MockDB() as unknown as D1Database & MockDB;

function worldOfSize(bytes: number): GameState {
  const base: any = { tick: 1, year: 1, season: 0, speed: 1, dwarves: [], stats: { mined: 0, built: 0, farmed: 0 }, homeCity: null };
  base.filler = 'x'.repeat(Math.max(0, bytes - JSON.stringify(base).length - 14));
  return base as GameState;
}

let mock: MockDB;
beforeEach(() => { mock = new MockDB(); });

describe('saveState', () => {
  it('writes the world in a single upsert, not select-then-insert', async () => {
    await saveState(mock as unknown as D1Database, worldOfSize(500));

    const writes = mock.statements.filter((s) => /INSERT|UPDATE/i.test(s.sql));
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/ON CONFLICT\(id\) DO UPDATE/);
    // No read before the write: that read was the race.
    expect(mock.statements.some((s) => /SELECT id FROM game_state/.test(s.sql))).toBe(false);
  });

  it('is idempotent across repeated saves', async () => {
    await saveState(mock as unknown as D1Database, worldOfSize(400));
    await saveState(mock as unknown as D1Database, worldOfSize(400));
    expect(mock.statements.filter((s) => /INSERT/i.test(s.sql))).toHaveLength(2);
    expect(mock.row).not.toBeNull();
  });

  it('refuses a world larger than the limit, and writes nothing', async () => {
    const tooBig = worldOfSize(MAX_STATE_BYTES + 5_000);

    await expect(saveState(mock as unknown as D1Database, tooBig)).rejects.toBeInstanceOf(StateTooLargeError);
    expect(mock.statements.filter((s) => /INSERT|UPDATE/i.test(s.sql))).toHaveLength(0);
    expect(mock.row).toBeNull();
  });

  it('measures UTF-8 bytes rather than string length', async () => {
    // 3 bytes per character: a string well under the limit by .length can exceed it by bytes.
    const chars = Math.floor(MAX_STATE_BYTES / 2);
    const multibyte: any = { tick: 1, dwarves: [], filler: '世'.repeat(chars) };

    await expect(saveState(mock as unknown as D1Database, multibyte)).rejects.toBeInstanceOf(StateTooLargeError);
    expect(JSON.stringify(multibyte).length).toBeLessThan(MAX_STATE_BYTES);
  });

  it('accepts a world just under the limit', async () => {
    await expect(saveState(mock as unknown as D1Database, worldOfSize(MAX_STATE_BYTES - 1_000))).resolves.toBeUndefined();
    expect(mock.row).not.toBeNull();
  });

  it('propagates a database write failure instead of reporting success', async () => {
    mock.failWrites = true;
    await expect(saveState(mock as unknown as D1Database, worldOfSize(300))).rejects.toThrow(/D1_ERROR/);
  });
});

describe('loadState', () => {
  it('returns null when no world has ever been saved', async () => {
    await expect(loadState(mock as unknown as D1Database)).resolves.toBeNull();
  });

  it('round-trips a saved world', async () => {
    const world = worldOfSize(600);
    await saveState(mock as unknown as D1Database, world);

    const loaded = await loadState(mock as unknown as D1Database);
    expect(loaded).toEqual(world);
  });

  it('throws on a corrupt row rather than reporting "no save"', async () => {
    // Truncated JSON is exactly what a partial write leaves behind. Returning null here
    // reads as a new game, and the client's next autosave overwrites recoverable state.
    mock.row = { state: '{"tick":1,"dwarv' };

    await expect(loadState(mock as unknown as D1Database)).rejects.toBeInstanceOf(StateCorruptError);
  });
});
