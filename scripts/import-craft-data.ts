#!/usr/bin/env npx tsx
/**
 * Import InfiniteCraftWiki data.json → D1-compatible SQL
 *
 * Source: https://infinitecraftwiki.com/data.json (~98MB)
 * Filters to depth ≤ 6 (296 items, ~29K recipes)
 * Outputs: migrations/0003_craft_seed.sql
 *
 * Usage:
 *   npx tsx scripts/import-craft-data.ts [path-to-data.json]
 *
 * If no path provided, downloads from InfiniteCraftWiki.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const MAX_DEPTH = 6;
const OUTPUT_PATH = join(__dirname, '..', 'migrations', '0003_craft_seed.sql');
const DATA_URL = 'https://infinitecraftwiki.com/data.json';

interface CraftIndex {
  [key: string]: [string, string, number]; // [emoji, name, depth]
}

function escapeSQL(s: string): string {
  return s.replace(/'/g, "''");
}

async function loadData(filePath?: string): Promise<{ index: CraftIndex; data: string }> {
  if (filePath && existsSync(filePath)) {
    console.log(`Loading from file: ${filePath}`);
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  console.log(`Downloading from ${DATA_URL}...`);
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const raw = await res.text();
  // Cache locally for future runs
  const cachePath = join(__dirname, '..', 'data.json');
  writeFileSync(cachePath, raw);
  console.log(`Cached to ${cachePath}`);
  return JSON.parse(raw);
}

async function main() {
  const inputPath = process.argv[2];
  const { index, data } = await loadData(inputPath);

  // Filter items to depth ≤ MAX_DEPTH
  const validKeys = new Set<string>();
  const items: Array<{ key: string; emoji: string; name: string; depth: number }> = [];

  for (const [key, [emoji, name, depth]] of Object.entries(index)) {
    if (depth <= MAX_DEPTH) {
      validKeys.add(key);
      items.push({ key, emoji, name, depth });
    }
  }

  // Sort by depth then name for deterministic output
  items.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

  // Assign sequential IDs (1-based)
  const keyToId = new Map<string, number>();
  items.forEach((item, i) => {
    keyToId.set(item.key, i + 1);
  });

  console.log(`Items at depth ≤ ${MAX_DEPTH}: ${items.length}`);

  // Parse recipes: semicolon-separated "a,b,c" strings
  const recipes: Array<{ aId: number; bId: number; resultId: number }> = [];
  const seenRecipes = new Set<string>();

  for (const entry of data.split(';')) {
    const parts = entry.split(',');
    if (parts.length !== 3) continue;
    const [a, b, c] = parts;

    // All three must be in our valid set
    if (!validKeys.has(a) || !validKeys.has(b) || !validKeys.has(c)) continue;

    const aId = keyToId.get(a)!;
    const bId = keyToId.get(b)!;
    const resultId = keyToId.get(c)!;

    // Normalize: smaller ID first
    const normA = Math.min(aId, bId);
    const normB = Math.max(aId, bId);
    const recipeKey = `${normA},${normB}`;

    if (seenRecipes.has(recipeKey)) continue;
    seenRecipes.add(recipeKey);

    recipes.push({ aId: normA, bId: normB, resultId });
  }

  console.log(`Recipes at depth ≤ ${MAX_DEPTH}: ${recipes.length}`);

  // Generate SQL
  const lines: string[] = [];
  lines.push('-- Auto-generated craft seed data (depth <= 6)');
  lines.push(`-- ${items.length} items, ${recipes.length} recipes`);
  lines.push('');

  // Insert items in batches of 100
  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    lines.push(`INSERT INTO craft_items (id, emoji, name, depth) VALUES`);
    const values = batch.map(
      (item, j) => `  (${i + j + 1}, '${escapeSQL(item.emoji)}', '${escapeSQL(item.name)}', ${item.depth})`
    );
    lines.push(values.join(',\n') + ';');
    lines.push('');
  }

  // Insert recipes in batches of 100
  for (let i = 0; i < recipes.length; i += 100) {
    const batch = recipes.slice(i, i + 100);
    lines.push(`INSERT INTO craft_recipes (item_a_id, item_b_id, result_id, source) VALUES`);
    const values = batch.map(
      (r) => `  (${r.aId}, ${r.bId}, ${r.resultId}, 'seed')`
    );
    lines.push(values.join(',\n') + ';');
    lines.push('');
  }

  writeFileSync(OUTPUT_PATH, lines.join('\n'));
  console.log(`Written to ${OUTPUT_PATH}`);
  console.log('Apply with: npx wrangler d1 migrations apply dwarf-planet-db --local');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
