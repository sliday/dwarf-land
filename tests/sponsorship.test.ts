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

const webhookMocks = vi.hoisted(() => ({
  validateEvent: vi.fn(),
  WebhookVerificationError: class extends Error {},
}));

class MockPolar {
  checkouts = {
    create: vi.fn(),
  };
}

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
  validateEvent: webhookMocks.validateEvent,
  WebhookVerificationError: webhookMocks.WebhookVerificationError,
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

  constructor(sponsorships: SponsorshipRow[] = []) {
    this.sponsorships = sponsorships.map((row) => ({ ...row }));
  }

  prepare(sql: string) {
    return {
      bind: (...args: any[]) => ({
        all: async () => this.handleAll(sql, args),
        first: async () => this.handleFirst(sql, args),
        run: async () => this.handleRun(sql, args),
      }),
    };
  }

  private async handleAll(sql: string, args: any[]) {
    if (sql.includes("FROM dwarf_sponsorships WHERE dwarf_id=? AND status='active' AND calls_remaining > 0")) {
      return {
        results: this.sponsorships.filter(
          (row) => row.dwarf_id === args[0] && row.status === 'active' && row.calls_remaining > 0
        ).map(({ claim_token, ...row }) => row),
      };
    }

    return { results: [] };
  }

  private async handleFirst(sql: string, args: any[]) {
    if (sql.includes('SELECT dwarf_id FROM dwarf_sponsorships WHERE checkout_id=?')) {
      const row = this.sponsorships.find((entry) => entry.checkout_id === args[0]);
      return row ? { dwarf_id: row.dwarf_id } : null;
    }

    return null;
  }

  private async handleRun(sql: string, args: any[]) {
    if (sql.includes("UPDATE dwarf_sponsorships SET status='active', activated_at=datetime('now') WHERE checkout_id=? AND status='pending'")) {
      const row = this.sponsorships.find((entry) => entry.checkout_id === args[0] && entry.status === 'pending');
      if (row) {
        row.status = 'active';
        row.activated_at = new Date().toISOString();
      }
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
    status: 'pending',
    claim_token: 'claim-token-000000000000000000000001',
    created_at: '2026-05-04T10:00:00.000Z',
    activated_at: null,
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
});

describe('Sponsorship routes', () => {
  it('keeps pending sponsorships pending on the success page', async () => {
    const db = new MockDB([createSponsorship()]);

    const response = await app.request('/success?checkout_id=chk-1', undefined, createEnv(db));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(db.sponsorships[0].status).toBe('pending');
    expect(html).toContain('Sponsorship Received');
    expect(html).toContain('/?dwarfId=dwarf-1');
  });

  it('keeps the success page return link generic for unknown checkout ids', async () => {
    const db = new MockDB([createSponsorship()]);

    const response = await app.request('/success?checkout_id=missing', undefined, createEnv(db));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('href="/"');
    expect(html).not.toContain('dwarfId=');
    expect(db.sponsorships[0].status).toBe('pending');
  });

  it('activates sponsorships only from a verified webhook event', async () => {
    const db = new MockDB([createSponsorship()]);
    webhookMocks.validateEvent.mockReturnValue({
      type: 'order.paid',
      data: { checkoutId: 'chk-1' },
    });

    const response = await app.request(
      '/api/sponsor/webhook',
      {
        method: 'POST',
        headers: { 'polar-signature': 'sig' },
        body: 'payload',
      },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(db.sponsorships[0].status).toBe('active');
    expect(db.sponsorships[0].activated_at).toBeTruthy();
    expect(webhookMocks.validateEvent).toHaveBeenCalledWith('payload', expect.any(Object), 'polar-secret');
  });

  it('ignores verified webhook events that are not paid orders', async () => {
    const db = new MockDB([createSponsorship()]);
    webhookMocks.validateEvent.mockReturnValue({
      type: 'order.created',
      data: { checkoutId: 'chk-1' },
    });

    const response = await app.request(
      '/api/sponsor/webhook',
      {
        method: 'POST',
        headers: { 'polar-signature': 'sig' },
        body: 'payload',
      },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(db.sponsorships[0].status).toBe('pending');
    expect(db.sponsorships[0].activated_at).toBeNull();
  });

  it('does not activate a paid webhook without a checkout id', async () => {
    const db = new MockDB([createSponsorship()]);
    webhookMocks.validateEvent.mockReturnValue({
      type: 'order.paid',
      data: {},
    });

    const response = await app.request(
      '/api/sponsor/webhook',
      {
        method: 'POST',
        headers: { 'polar-signature': 'sig' },
        body: 'payload',
      },
      createEnv(db)
    );

    expect(response.status).toBe(200);
    expect(db.sponsorships[0].status).toBe('pending');
    expect(db.sponsorships[0].activated_at).toBeNull();
  });

  it('rejects invalid webhook signatures', async () => {
    const db = new MockDB([createSponsorship()]);
    webhookMocks.validateEvent.mockImplementation(() => {
      throw new webhookMocks.WebhookVerificationError('bad signature');
    });

    const response = await app.request(
      '/api/sponsor/webhook',
      {
        method: 'POST',
        headers: { 'polar-signature': 'bad' },
        body: 'payload',
      },
      createEnv(db)
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Invalid signature');
    expect(db.sponsorships[0].status).toBe('pending');
  });

  it('returns the strongest active sponsorship on the status route', async () => {
    const db = new MockDB([
      createSponsorship({
        id: 1,
        tier: 'bronze',
        ai_tier: 'medium',
        amount_cents: 100,
        status: 'active',
        activated_at: '2026-05-04T10:10:00.000Z',
      }),
      createSponsorship({
        id: 2,
        tier: 'gold',
        ai_tier: 'premium',
        status: 'active',
        activated_at: '2026-05-04T10:05:00.000Z',
      }),
    ]);

    const response = await app.request('/api/sponsor/status/dwarf-1', undefined, createEnv(db));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sponsorship.ai_tier).toBe('premium');
    expect(payload.sponsorship.id).toBe(2);
    expect(payload.sponsorship.claim_token).toBeUndefined();
  });

  it('returns null when a dwarf has no active calls remaining', async () => {
    const db = new MockDB([
      createSponsorship({ id: 1, status: 'active', calls_remaining: 0 }),
      createSponsorship({ id: 2, status: 'expired', calls_remaining: 20 }),
    ]);

    const response = await app.request('/api/sponsor/status/dwarf-1', undefined, createEnv(db));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sponsorship).toBeNull();
  });
});
