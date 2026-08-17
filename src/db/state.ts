import type { GameState } from '../shared/types';

/**
 * D1 refuses a row larger than 2,000,000 bytes. The live world crossed that ceiling and
 * writes have been failing since, so guard the serialized string here rather than only at
 * the route: this is the value that actually meets the limit.
 */
export const MAX_STATE_BYTES = 1_500_000;

export class StateTooLargeError extends Error {
  constructor(public readonly bytes: number) {
    super(`Serialized state is ${bytes} bytes, over the ${MAX_STATE_BYTES} byte limit`);
    this.name = 'StateTooLargeError';
  }
}

export class StateCorruptError extends Error {
  constructor() {
    super('Stored state is not valid JSON');
    this.name = 'StateCorruptError';
  }
}

export async function saveState(db: D1Database, state: GameState): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const json = JSON.stringify(state);

  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_STATE_BYTES) throw new StateTooLargeError(bytes);

  // Single upsert. The old select-then-insert let two concurrent first-ever saves both
  // take the INSERT branch and collide on the primary key.
  await db.prepare(
    `INSERT INTO game_state (id, state, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
  ).bind(json, now).run();
}

export async function loadState(db: D1Database): Promise<GameState | null> {
  const row = await db.prepare(
    'SELECT state FROM game_state WHERE id = 1'
  ).first<{ state: string }>();

  if (!row) return null;
  try {
    return JSON.parse(row.state) as GameState;
  } catch {
    // Returning null here made a corrupt row look like "no save yet", so the client
    // started a fresh world and the next autosave overwrote recoverable state. Throw
    // instead and let the route refuse.
    throw new StateCorruptError();
  }
}
