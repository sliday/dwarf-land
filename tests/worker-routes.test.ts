import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({
  routeDecision: vi.fn(),
  generateBackstory: vi.fn(),
  generateCraftResult: vi.fn(),
  generateEpitaph: vi.fn(),
}));

const budgetMocks = vi.hoisted(() => ({
  checkBudget: vi.fn(),
  logUsage: vi.fn(),
}));

const rateLimiterMocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
}));

class MockPolar {
  checkouts = {
    create: vi.fn(),
  };
}

class MockWebhookVerificationError extends Error {}

vi.mock('../src/ai/router', () => ({
  routeDecision: routerMocks.routeDecision,
  generateBackstory: routerMocks.generateBackstory,
  generateCraftResult: routerMocks.generateCraftResult,
  generateEpitaph: routerMocks.generateEpitaph,
}));

vi.mock('../src/guardrails/budget', async () => {
  const actual = await vi.importActual<typeof import('../src/guardrails/budget')>('../src/guardrails/budget');
  return {
    ...actual,
    checkBudget: budgetMocks.checkBudget,
    logUsage: budgetMocks.logUsage,
  };
});

vi.mock('../src/guardrails/rate-limiter', () => ({
  checkRateLimit: rateLimiterMocks.checkRateLimit,
}));

vi.mock('@polar-sh/sdk', () => ({
  Polar: MockPolar,
}));

vi.mock('@polar-sh/sdk/webhooks', () => ({
  validateEvent: vi.fn(),
  WebhookVerificationError: MockWebhookVerificationError,
}));

type SponsorshipRow = {
  id: number;
  dwarf_id: string;
  checkout_id: string;
  tier: string;
  ai_tier: 'medium' | 'complex' | 'premium';
  calls_remaining: number;
  calls_total: number;
  amount_cents: number;
  status: 'pending' | 'active' | 'expired';
  claim_token: string | null;
  created_at: string;
  activated_at: string | null;
  expired_at: string | null;
};

class MockDB {
  sponsorships: SponsorshipRow[];
  savedState: string | null = null;

  constructor(sponsorships: SponsorshipRow[] = []) {
    this.sponsorships = sponsorships.map((row) => ({ ...row }));
  }

  prepare(sql: string) {
    return {
      all: async () => this.handleAll(sql, []),
      first: async () => this.handleFirst(sql, []),
      run: async () => this.handleRun(sql, []),
      bind: (...args: any[]) => ({
        all: async () => this.handleAll(sql, args),
        first: async () => this.handleFirst(sql, args),
        run: async () => this.handleRun(sql, args),
      }),
    };
  }

  private async handleAll(sql: string, args: any[]) {
    if (sql.includes('FROM dwarf_sponsorships WHERE (')) {
      return {
        results: this.sponsorships.filter(
          (row) => {
            const matchesClaim = args.some((arg, index) => index % 2 === 0 && arg === row.dwarf_id && args[index + 1] === row.claim_token);
            return matchesClaim && row.status === 'active' && row.calls_remaining > 0;
          }
        ),
      };
    }

    if (sql.includes("FROM dwarf_sponsorships WHERE dwarf_id=? AND status='active' AND calls_remaining > 0")) {
      return {
        results: this.sponsorships.filter(
          (row) => row.dwarf_id === args[0] && row.status === 'active' && row.calls_remaining > 0
        ),
      };
    }

    return { results: [] };
  }

  private async handleFirst(sql: string, args: any[]) {
    if (sql.includes('SELECT id FROM game_state WHERE id = 1')) {
      return this.savedState ? { id: 1 } : null;
    }

    if (sql.includes('SELECT dwarf_id FROM dwarf_sponsorships WHERE checkout_id=?')) {
      const row = this.sponsorships.find((entry) => entry.checkout_id === args[0]);
      return row ? { dwarf_id: row.dwarf_id } : null;
    }

    return null;
  }

  private async handleRun(sql: string, args: any[]) {
    if (sql.includes("UPDATE dwarf_sponsorships SET calls_remaining = calls_remaining - 1 WHERE id=?")) {
      const row = this.sponsorships.find((entry) => entry.id === args[0] && entry.status === 'active' && entry.calls_remaining > 0);
      if (row) row.calls_remaining -= 1;
      return {};
    }

    if (sql.includes("UPDATE dwarf_sponsorships SET status='expired'")) {
      const row = this.sponsorships.find((entry) => entry.id === args[0] && entry.status === 'active' && entry.calls_remaining <= 0);
      if (row) {
        row.status = 'expired';
        row.expired_at = new Date().toISOString();
      }
      return {};
    }

    if (sql.includes('UPDATE game_state SET state = ?')) {
      this.savedState = args[0];
      return {};
    }

    if (sql.includes('INSERT INTO game_state')) {
      this.savedState = args[0];
      return {};
    }

    return {};
  }
}

function createSponsorship(overrides: Partial<SponsorshipRow> = {}): SponsorshipRow {
  return {
    id: 1,
    dwarf_id: 'dwarf-1',
    checkout_id: 'chk-1',
    tier: 'gold',
    ai_tier: 'premium',
    calls_remaining: 5,
    calls_total: 5,
    amount_cents: 1000,
    status: 'active',
    claim_token: 'claim-token-000000000000000000000001',
    created_at: '2026-05-04T10:00:00.000Z',
    activated_at: '2026-05-04T10:05:00.000Z',
    expired_at: null,
    ...overrides,
  };
}

function createEnv(db: MockDB) {
  return {
    DB: db as unknown as D1Database,
    OPENROUTER_API_KEY: 'openrouter-key',
    POLAR_ACCESS_TOKEN: 'polar-token',
    POLAR_WEBHOOK_SECRET: 'polar-secret',
  };
}

let app: Awaited<typeof import('../src/worker')>['default'];

beforeAll(async () => {
  ({ default: app } = await import('../src/worker'));
});

beforeEach(() => {
  vi.clearAllMocks();
  rateLimiterMocks.checkRateLimit.mockReturnValue(true);
  budgetMocks.checkBudget.mockResolvedValue(true);
  budgetMocks.logUsage.mockResolvedValue(undefined);
  routerMocks.routeDecision.mockResolvedValue({
    decisions: [{ dwarfId: 'dwarf-1', action: 'mine' }],
    model: 'mock-decision-model',
    tokensIn: 10,
    tokensOut: 5,
    costCents: 1,
  });
  routerMocks.generateBackstory.mockResolvedValue({
    backstory: { name: 'Borin', backstory: 'Borin digs.', traits: ['stubborn'] },
    model: 'mock-backstory-model',
    tokensIn: 10,
    tokensOut: 5,
    costCents: 1,
  });
  routerMocks.generateEpitaph.mockResolvedValue({
    epitaph: 'Rest in peace.',
    model: 'mock-epitaph-model',
    tokensIn: 8,
    tokensOut: 4,
    costCents: 1,
  });
});

describe('Worker routes', () => {
  it('uses the sponsored tier for rate and budget checks', async () => {
    const db = new MockDB([createSponsorship()]);
    rateLimiterMocks.checkRateLimit.mockImplementation((tier: string) => tier === 'premium');

    const response = await app.request(
      '/api/decide/simple',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dwarves: [{ id: 'dwarf-1' }],
          sponsorshipClaims: [{ dwarfId: 'dwarf-1', claimToken: 'claim-token-000000000000000000000001' }],
        }),
      },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    expect(rateLimiterMocks.checkRateLimit).toHaveBeenCalledTimes(1);
    expect(rateLimiterMocks.checkRateLimit).toHaveBeenCalledWith('premium');
    expect(budgetMocks.checkBudget).toHaveBeenCalledWith(expect.anything(), 'premium', 4);
    expect(routerMocks.routeDecision).toHaveBeenCalledWith(
      'premium',
      expect.objectContaining({ dwarves: [{ id: 'dwarf-1' }] }),
      'openrouter-key'
    );
  });

  it('does not spend sponsorships when only a public dwarf id is sent', async () => {
    const db = new MockDB([createSponsorship({ calls_remaining: 5 })]);

    const response = await app.request(
      '/api/decide/simple',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dwarves: [{ id: 'dwarf-1' }] }),
      },
      createEnv(db)
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rateLimiterMocks.checkRateLimit).toHaveBeenCalledWith('simple');
    expect(routerMocks.routeDecision).toHaveBeenCalledWith(
      'simple',
      expect.objectContaining({ dwarves: [{ id: 'dwarf-1' }] }),
      'openrouter-key'
    );
    expect(payload.sponsoredDwarfIds).toEqual([]);
    expect(db.sponsorships[0].calls_remaining).toBe(5);
  });

  it('decrements one active sponsorship row per dwarf request', async () => {
    const db = new MockDB([
      createSponsorship({ id: 1, ai_tier: 'premium', calls_remaining: 3 }),
      createSponsorship({
        id: 2,
        tier: 'bronze',
        ai_tier: 'medium',
        calls_remaining: 7,
        calls_total: 7,
        amount_cents: 100,
        created_at: '2026-05-04T10:10:00.000Z',
        activated_at: '2026-05-04T10:15:00.000Z',
      }),
    ]);

    const response = await app.request(
      '/api/decide/simple',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dwarves: [{ id: 'dwarf-1' }],
          sponsorshipClaims: [{ dwarfId: 'dwarf-1', claimToken: 'claim-token-000000000000000000000001' }],
        }),
      },
      createEnv(db)
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sponsoredDwarfIds).toEqual(['dwarf-1']);
    expect(db.sponsorships.find((row) => row.id === 1)?.calls_remaining).toBe(2);
    expect(db.sponsorships.find((row) => row.id === 2)?.calls_remaining).toBe(7);
  });

  it('expires the selected sponsorship row when the final call is consumed', async () => {
    const db = new MockDB([createSponsorship({ calls_remaining: 1, calls_total: 1 })]);

    const response = await app.request(
      '/api/decide/simple',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dwarves: [{ id: 'dwarf-1' }],
          sponsorshipClaims: [{ dwarfId: 'dwarf-1', claimToken: 'claim-token-000000000000000000000001' }],
        }),
      },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    expect(db.sponsorships[0].calls_remaining).toBe(0);
    expect(db.sponsorships[0].status).toBe('expired');
    expect(db.sponsorships[0].expired_at).toBeTruthy();
  });

  it('does not decrement sponsored calls when the effective tier is rate limited', async () => {
    const db = new MockDB([createSponsorship({ calls_remaining: 5 })]);
    rateLimiterMocks.checkRateLimit.mockReturnValue(false);

    const response = await app.request(
      '/api/decide/simple',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dwarves: [{ id: 'dwarf-1' }],
          sponsorshipClaims: [{ dwarfId: 'dwarf-1', claimToken: 'claim-token-000000000000000000000001' }],
        }),
      },
      createEnv(db)
    );

    expect(response.status).toBe(429);
    expect(rateLimiterMocks.checkRateLimit).toHaveBeenCalledWith('premium');
    expect(budgetMocks.checkBudget).not.toHaveBeenCalled();
    expect(routerMocks.routeDecision).not.toHaveBeenCalled();
    expect(db.sponsorships[0].calls_remaining).toBe(5);
  });

  it('deduplicates repeated dwarf ids before sponsorship accounting', async () => {
    const db = new MockDB([createSponsorship({ calls_remaining: 5 })]);

    const response = await app.request(
      '/api/decide/simple',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dwarves: [{ id: 'dwarf-1' }, { id: 'dwarf-1' }],
          sponsorshipClaims: [{ dwarfId: 'dwarf-1', claimToken: 'claim-token-000000000000000000000001' }],
        }),
      },
      createEnv(db)
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sponsoredDwarfIds).toEqual(['dwarf-1']);
    expect(db.sponsorships[0].calls_remaining).toBe(4);
  });

  it('uses the highest sponsored tier across a multi-dwarf request', async () => {
    const db = new MockDB([
      createSponsorship({ id: 1, dwarf_id: 'dwarf-1', tier: 'bronze', ai_tier: 'medium', amount_cents: 100 }),
      createSponsorship({ id: 2, dwarf_id: 'dwarf-2', checkout_id: 'chk-2', tier: 'silver', ai_tier: 'complex', amount_cents: 300, claim_token: 'claim-token-000000000000000000000002' }),
    ]);

    const response = await app.request(
      '/api/decide/simple',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dwarves: [{ id: 'dwarf-1' }, { id: 'dwarf-2' }],
          sponsorshipClaims: [
            { dwarfId: 'dwarf-1', claimToken: 'claim-token-000000000000000000000001' },
            { dwarfId: 'dwarf-2', claimToken: 'claim-token-000000000000000000000002' },
          ],
        }),
      },
      createEnv(db)
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rateLimiterMocks.checkRateLimit).toHaveBeenCalledWith('complex');
    expect(budgetMocks.checkBudget).toHaveBeenCalledWith(expect.anything(), 'complex', 2);
    expect(payload.sponsoredDwarfIds).toEqual(['dwarf-1', 'dwarf-2']);
    expect(db.sponsorships.map((row) => row.calls_remaining)).toEqual([4, 4]);
  });

  it('enforces budget on /api/epitaph', async () => {
    const db = new MockDB();
    budgetMocks.checkBudget.mockResolvedValue(false);

    const response = await app.request(
      '/api/epitaph',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Borin', cause: 'fell in battle', age: 120 }),
      },
      createEnv(db)
    );

    expect(response.status).toBe(429);
    expect(budgetMocks.checkBudget).toHaveBeenCalledWith(expect.anything(), 'simple', 1);
    expect(routerMocks.generateEpitaph).not.toHaveBeenCalled();
  });

  it('checks projected batch spend before generating backstories', async () => {
    const db = new MockDB();
    budgetMocks.checkBudget.mockResolvedValue(false);

    const response = await app.request(
      '/api/backstory/batch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dwarves: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
      },
      createEnv(db)
    );

    expect(response.status).toBe(429);
    expect(budgetMocks.checkBudget).toHaveBeenCalledWith(expect.anything(), 'medium', 3);
    expect(routerMocks.generateBackstory).not.toHaveBeenCalled();
  });

  it('rejects public state saves without a same-origin request', async () => {
    const db = new MockDB();

    const response = await app.request(
      '/api/state/save',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ tick: 1, year: 1, season: 0, speed: 1, dwarves: [], stats: { mined: 0, built: 0, farmed: 0 }, homeCity: null }),
      },
      createEnv(db)
    );

    expect(response.status).toBe(403);
    expect(db.savedState).toBeNull();
  });

  it('allows same-origin state saves', async () => {
    const db = new MockDB();

    const response = await app.request(
      'https://dwarf.land/api/state/save',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://dwarf.land' },
        body: JSON.stringify({ tick: 2, year: 1, season: 0, speed: 1, dwarves: [], stats: { mined: 0, built: 0, farmed: 0 }, homeCity: null }),
      },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(db.savedState || '{}').tick).toBe(2);
  });
});
