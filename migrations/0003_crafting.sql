CREATE TABLE IF NOT EXISTS craft_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emoji TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  depth INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS craft_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_a_id INTEGER NOT NULL,
  item_b_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  source TEXT DEFAULT 'seed',
  UNIQUE(item_a_id, item_b_id),
  FOREIGN KEY (item_a_id) REFERENCES craft_items(id),
  FOREIGN KEY (item_b_id) REFERENCES craft_items(id),
  FOREIGN KEY (result_id) REFERENCES craft_items(id)
);

CREATE INDEX idx_recipes_lookup ON craft_recipes(item_a_id, item_b_id);
