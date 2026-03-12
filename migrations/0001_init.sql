-- Game state: single row, updated every 60s
CREATE TABLE game_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Budget tracking: one row per tier per hour
CREATE TABLE budget_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL,
  hour TEXT NOT NULL,
  calls INTEGER DEFAULT 0,
  cost_cents INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX idx_budget_tier_hour ON budget_log(tier, hour);

-- AI decision log (for debugging/analytics)
CREATE TABLE ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_cents INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ai_log_created ON ai_log(created_at);
