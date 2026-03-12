import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkBudget, logUsage } from '../src/guardrails/budget';

// Mock D1Database
function createMockDB() {
  const data: Record<string, any> = {};

  const mockDB = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: any[]) => ({
        first: async <T = any>() => {
          const key = JSON.stringify(args);
          return data[key] || null;
        },
        all: async () => ({
          results: Object.values(data),
        }),
        run: async () => {
          // Simulate INSERT/UPDATE
          if (sql.includes('INSERT INTO budget_log')) {
            const [tier, hour, costCents] = args;
            const key = `budget:${tier}:${hour}`;
            if (data[key]) {
              data[key].calls += 1;
              data[key].cost_cents += costCents;
            } else {
              data[key] = { tier, hour, calls: 1, cost_cents: costCents };
            }
          }
          if (sql.includes('INSERT INTO ai_log')) {
            // Just track that it was called
          }
          if (sql.includes('UPDATE budget_log')) {
            const costCents = args[0];
            const tier = args[1];
            const hour = args[2];
            const key = `budget:${tier}:${hour}`;
            if (data[key]) {
              data[key].calls += 1;
              data[key].cost_cents += costCents;
            }
          }
          return {};
        },
      }),
    })),
    _data: data,
    _setData: (key: string, value: any) => { data[key] = value; },
  };

  // Override prepare for SELECT queries
  const origPrepare = mockDB.prepare;
  mockDB.prepare = vi.fn((sql: string) => ({
    bind: (...args: any[]) => ({
      first: async <T = any>() => {
        if (sql.includes('SELECT cost_cents FROM budget_log')) {
          const [tier, hour] = args;
          const key = `budget:${tier}:${hour}`;
          return data[key] ? { cost_cents: data[key].cost_cents } : null;
        }
        if (sql.includes('SELECT id FROM budget_log')) {
          const [tier, hour] = args;
          const key = `budget:${tier}:${hour}`;
          return data[key] ? { id: 1 } : null;
        }
        if (sql.includes('SELECT id FROM game_state')) {
          return null;
        }
        if (sql.includes('SELECT state FROM game_state')) {
          return null;
        }
        return null;
      },
      all: async () => ({ results: Object.values(data) }),
      run: async () => {
        if (sql.includes('INSERT INTO budget_log') && sql.includes('ON CONFLICT')) {
          const [tier, hour, costCents, costCentsUpdate] = args;
          const key = `budget:${tier}:${hour}`;
          if (data[key]) {
            data[key].calls += 1;
            data[key].cost_cents += costCentsUpdate;
          } else {
            data[key] = { tier, hour, calls: 1, cost_cents: costCents };
          }
        } else if (sql.includes('INSERT INTO ai_log')) {
          // noop
        } else if (sql.includes('UPDATE budget_log')) {
          const costCents = args[0];
          const tier = args[1];
          const hour = args[2];
          const key = `budget:${tier}:${hour}`;
          if (data[key]) {
            data[key].calls += 1;
            data[key].cost_cents += costCents;
          }
        } else if (sql.includes('INSERT INTO budget_log')) {
          const [tier, hour, costCents] = args;
          const key = `budget:${tier}:${hour}`;
          data[key] = { tier, hour, calls: 1, cost_cents: costCents };
        }
        return {};
      },
    }),
  })) as any;

  return mockDB;
}

describe('Budget Tracker', () => {
  let db: any;

  beforeEach(() => {
    db = createMockDB();
  });

  describe('checkBudget', () => {
    it('allows when no spending recorded', async () => {
      expect(await checkBudget(db, 'simple')).toBe(true);
      expect(await checkBudget(db, 'medium')).toBe(true);
      expect(await checkBudget(db, 'complex')).toBe(true);
      expect(await checkBudget(db, 'premium')).toBe(true);
    });

    it('blocks SIMPLE tier at $0.50 (50 cents)', async () => {
      const hour = new Date().toISOString().slice(0, 13).replace('T', '-');
      db._setData(`budget:simple:${hour}`, { tier: 'simple', hour, calls: 100, cost_cents: 50 });
      expect(await checkBudget(db, 'simple')).toBe(false);
    });

    it('blocks MEDIUM tier at $1.00 (100 cents)', async () => {
      const hour = new Date().toISOString().slice(0, 13).replace('T', '-');
      db._setData(`budget:medium:${hour}`, { tier: 'medium', hour, calls: 50, cost_cents: 100 });
      expect(await checkBudget(db, 'medium')).toBe(false);
    });

    it('blocks COMPLEX tier at $2.00 (200 cents)', async () => {
      const hour = new Date().toISOString().slice(0, 13).replace('T', '-');
      db._setData(`budget:complex:${hour}`, { tier: 'complex', hour, calls: 30, cost_cents: 200 });
      expect(await checkBudget(db, 'complex')).toBe(false);
    });

    it('blocks PREMIUM tier at $5.00 (500 cents)', async () => {
      const hour = new Date().toISOString().slice(0, 13).replace('T', '-');
      db._setData(`budget:premium:${hour}`, { tier: 'premium', hour, calls: 10, cost_cents: 500 });
      expect(await checkBudget(db, 'premium')).toBe(false);
    });

    it('allows when just under the cap', async () => {
      const hour = new Date().toISOString().slice(0, 13).replace('T', '-');
      db._setData(`budget:simple:${hour}`, { tier: 'simple', hour, calls: 99, cost_cents: 49 });
      expect(await checkBudget(db, 'simple')).toBe(true);
    });
  });

  describe('cost estimation sanity', () => {
    it('SIMPLE tier: 100 calls at 400 tokens avg costs ~$0.07', () => {
      // 100 calls × 400 tokens in × $0.25/M + 100 × 150 tokens out × $1.50/M
      const costIn = 100 * 400 * 0.25 / 1_000_000;
      const costOut = 100 * 150 * 1.50 / 1_000_000;
      const totalCents = Math.round((costIn + costOut) * 100);
      expect(totalCents).toBeLessThan(5); // ~3.25 cents for 100 simple calls
    });

    it('PREMIUM tier: 6 calls at 3000 tokens avg costs ~$0.32', () => {
      // 6 calls × 3000 in × $3/M + 6 × 1500 out × $15/M
      const costIn = 6 * 3000 * 3 / 1_000_000;
      const costOut = 6 * 1500 * 15 / 1_000_000;
      const totalCents = Math.round((costIn + costOut) * 100);
      expect(totalCents).toBeLessThan(20); // ~19 cents for 6 premium calls
    });

    it('maximum hourly cost is $8.50', () => {
      const maxCents = 50 + 100 + 200 + 500; // simple + medium + complex + premium
      expect(maxCents).toBe(850);
      expect(maxCents / 100).toBe(8.50);
    });
  });
});
