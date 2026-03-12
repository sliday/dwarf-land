CREATE TABLE IF NOT EXISTS dwarf_sponsorships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dwarf_id TEXT NOT NULL,
  checkout_id TEXT UNIQUE,
  tier TEXT NOT NULL CHECK(tier IN ('bronze','silver','gold')),
  ai_tier TEXT NOT NULL CHECK(ai_tier IN ('medium','complex','premium')),
  calls_remaining INTEGER NOT NULL,
  calls_total INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired')),
  created_at TEXT DEFAULT (datetime('now')),
  activated_at TEXT,
  expired_at TEXT
);
