import type { GameState } from '../shared/types';

export async function saveState(db: D1Database, state: GameState): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const json = JSON.stringify(state);

  const existing = await db.prepare('SELECT id FROM game_state WHERE id = 1').first();
  if (existing) {
    await db.prepare(
      'UPDATE game_state SET state = ?, updated_at = ? WHERE id = 1'
    ).bind(json, now).run();
  } else {
    await db.prepare(
      'INSERT INTO game_state (id, state, updated_at) VALUES (1, ?, ?)'
    ).bind(json, now).run();
  }
}

export async function loadState(db: D1Database): Promise<GameState | null> {
  const row = await db.prepare(
    'SELECT state FROM game_state WHERE id = 1'
  ).first<{ state: string }>();

  if (!row) return null;
  try {
    return JSON.parse(row.state) as GameState;
  } catch {
    return null;
  }
}
