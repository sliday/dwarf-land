import type { Tier } from '../shared/types';

// Hard caps in cents per hour
export const MAX_CENTS_PER_HOUR: Record<Tier, number> = {
  simple: 50,    // $0.50
  medium: 100,   // $1.00
  complex: 200,  // $2.00
  premium: 500,  // $5.00
};

// Total ceiling across every tier, derived so /api/health cannot drift from the caps above.
export const MAX_TOTAL_CENTS_PER_HOUR = Object.values(MAX_CENTS_PER_HOUR).reduce((sum, c) => sum + c, 0);

const PROJECTED_CENTS_PER_CALL: Record<Tier, number> = {
  simple: 1,
  medium: 1,
  complex: 2,
  premium: 4,
};

function currentHour(): string {
  return new Date().toISOString().slice(0, 13).replace('T', '-');
}

export function getProjectedCostCents(tier: Tier, requestCount = 1): number {
  return PROJECTED_CENTS_PER_CALL[tier] * Math.max(1, requestCount);
}

export async function checkBudget(
  db: D1Database,
  tier: Tier,
  projectedCostCents = getProjectedCostCents(tier)
): Promise<boolean> {
  const hour = currentHour();
  const row = await db.prepare(
    'SELECT cost_cents FROM budget_log WHERE tier = ? AND hour = ?'
  ).bind(tier, hour).first<{ cost_cents: number }>();

  const spent = row?.cost_cents ?? 0;
  return spent + Math.max(0, projectedCostCents) <= MAX_CENTS_PER_HOUR[tier];
}

export async function logUsage(
  db: D1Database,
  tier: Tier,
  model: string,
  tokensIn: number,
  tokensOut: number,
  costCents: number
): Promise<void> {
  const hour = currentHour();
  const now = Math.floor(Date.now() / 1000);

  // Upsert budget_log
  await db.prepare(`
    INSERT INTO budget_log (tier, hour, calls, cost_cents)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(tier, hour) DO UPDATE SET
      calls = calls + 1,
      cost_cents = cost_cents + ?
  `).bind(tier, hour, costCents, costCents).run().catch(async () => {
    // If ON CONFLICT fails (no unique index on tier+hour), try update then insert
    const existing = await db.prepare(
      'SELECT id FROM budget_log WHERE tier = ? AND hour = ?'
    ).bind(tier, hour).first();
    if (existing) {
      await db.prepare(
        'UPDATE budget_log SET calls = calls + 1, cost_cents = cost_cents + ? WHERE tier = ? AND hour = ?'
      ).bind(costCents, tier, hour).run();
    } else {
      await db.prepare(
        'INSERT INTO budget_log (tier, hour, calls, cost_cents) VALUES (?, ?, 1, ?)'
      ).bind(tier, hour, costCents).run();
    }
  });

  // Log to ai_log
  await db.prepare(
    'INSERT INTO ai_log (tier, model, tokens_in, tokens_out, cost_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(tier, model, tokensIn, tokensOut, costCents, now).run();
}
