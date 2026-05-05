import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(process.cwd(), 'migrations');

function readMigration(name: string) {
  return readFileSync(join(migrationsDir, name), 'utf8');
}

describe('D1 migrations', () => {
  it('keeps sponsorship indexes in a forward migration', () => {
    const originalSponsorshipMigration = readMigration('0002_sponsorships.sql');
    const indexMigration = readMigration('0004_sponsorship_indexes.sql');
    const claimMigration = readMigration('0005_sponsorship_claim_tokens.sql');

    expect(originalSponsorshipMigration).not.toContain('idx_dwarf_sponsorships_checkout_status');
    expect(originalSponsorshipMigration).not.toContain('idx_dwarf_sponsorships_active_lookup');
    expect(indexMigration).toContain('idx_dwarf_sponsorships_checkout_status');
    expect(indexMigration).toContain('idx_dwarf_sponsorships_active_lookup');
    expect(indexMigration).toContain("WHERE status = 'active' AND calls_remaining > 0");
    expect(claimMigration).toContain('claim_token TEXT');
    expect(claimMigration).toContain('idx_dwarf_sponsorships_claim_token');
  });

  it('uses unique increasing numeric migration prefixes', () => {
    const prefixes = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => Number(name.slice(0, 4)));

    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes).toEqual([...prefixes].sort((a, b) => a - b));
  });
});
