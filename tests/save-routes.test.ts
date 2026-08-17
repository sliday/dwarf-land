import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STATE_BYTES } from '../src/db/state';

const routerMocks = vi.hoisted(() => ({
  routeDecision: vi.fn(),
  generateBackstory: vi.fn(),
  generateCraftResult: vi.fn(),
  generateEpitaph: vi.fn(),
}));
const budgetMocks = vi.hoisted(() => ({ checkBudget: vi.fn(), logUsage: vi.fn() }));
const rateLimiterMocks = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock('../src/ai/router', () => routerMocks);
vi.mock('../src/guardrails/budget', async () => {
  const actual = await vi.importActual<typeof import('../src/guardrails/budget')>('../src/guardrails/budget');
  return { ...actual, checkBudget: budgetMocks.checkBudget, logUsage: budgetMocks.logUsage };
});
vi.mock('../src/guardrails/rate-limiter', () => ({ checkRateLimit: rateLimiterMocks.checkRateLimit }));
vi.mock('@polar-sh/sdk', () => ({ Polar: class { checkouts = { create: vi.fn() }; } }));
vi.mock('@polar-sh/sdk/webhooks', () => ({
  validateEvent: vi.fn(),
  WebhookVerificationError: class extends Error {},
}));

type Sponsorship = {
  id: number; dwarf_id: string; ai_tier: string; calls_remaining: number;
  status: string; claim_token: string; created_at: string; activated_at: string | null;
};

class MockDB {
  savedState: string | null = null;
  storedRow: { state: string } | null = null;
  sponsorships: Sponsorship[] = [];
  writes = 0;

  prepare(sql: string) {
    const exec = (args: any[]) => this.run(sql, args);
    const read = (args: any[]) => this.first(sql, args);
    return {
      all: async () => this.all(sql, []),
      first: async () => read([]),
      run: async () => exec([]),
      bind: (...args: any[]) => ({
        all: async () => this.all(sql, args),
        first: async () => read(args),
        run: async () => exec(args),
      }),
    };
  }

  private all(sql: string, args: any[]) {
    if (sql.includes('FROM dwarf_sponsorships WHERE (')) {
      const results = this.sponsorships.filter((row) =>
        args.some((a, i) => i % 2 === 0 && a === row.dwarf_id && args[i + 1] === row.claim_token) &&
        row.status === 'active' && row.calls_remaining > 0);
      return { results };
    }
    return { results: [] };
  }

  private first(sql: string, _args: any[]) {
    if (sql.includes('SELECT state FROM game_state')) return this.storedRow;
    return null;
  }

  private run(sql: string, args: any[]) {
    if (sql.includes('INSERT INTO game_state')) {
      this.writes++;
      this.savedState = args[0];
      this.storedRow = { state: args[0] };
    }
    if (sql.includes('calls_remaining = calls_remaining - 1')) {
      const row = this.sponsorships.find((s) => s.id === args[0] && s.calls_remaining > 0);
      if (row) row.calls_remaining--;
    }
    return {};
  }
}

const env = (db: MockDB) => ({
  DB: db as unknown as D1Database,
  OPENROUTER_API_KEY: 'k',
  POLAR_ACCESS_TOKEN: 't',
  POLAR_WEBHOOK_SECRET: 's',
});

const ORIGIN = 'http://localhost';
const post = (body: string | object, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

let app: Awaited<typeof import('../src/worker')>['default'];
beforeAll(async () => { ({ default: app } = await import('../src/worker')); });

beforeEach(() => {
  vi.clearAllMocks();
  rateLimiterMocks.checkRateLimit.mockReturnValue(true);
  budgetMocks.checkBudget.mockResolvedValue(true);
  budgetMocks.logUsage.mockResolvedValue(undefined);
  routerMocks.routeDecision.mockResolvedValue({
    decisions: [], model: 'google/gemini-3.1-flash-lite-preview', tokensIn: 5, tokensOut: 5, costCents: 1,
  });
  routerMocks.generateBackstory.mockResolvedValue({
    backstory: { name: 'B', backstory: 'b', traits: ['x'] }, model: 'm', tokensIn: 1, tokensOut: 1, costCents: 1,
  });
});

function bigBody(bytes: number) {
  return JSON.stringify({ tick: 1, dwarves: [], filler: 'x'.repeat(bytes) });
}

describe('POST /api/state/save size ceiling', () => {
  it('rejects an oversized body with 413 and writes nothing', async () => {
    const db = new MockDB();
    const res = await app.request('/api/state/save', post(bigBody(MAX_STATE_BYTES + 1000)), env(db));

    expect(res.status).toBe(413);
    expect(db.savedState).toBeNull();
    expect(db.writes).toBe(0);
  });

  it('rejects even when Content-Length understates the real size', async () => {
    // The header is caller-supplied. Enforcement has to read actual bytes.
    const db = new MockDB();
    const res = await app.request(
      '/api/state/save',
      post(bigBody(MAX_STATE_BYTES + 1000), { 'content-length': '42' }),
      env(db)
    );

    expect(res.status).toBe(413);
    expect(db.writes).toBe(0);
  });

  it('accepts a body under the ceiling', async () => {
    const db = new MockDB();
    const res = await app.request('/api/state/save', post({ tick: 7, dwarves: [] }), env(db));

    expect(res.status).toBe(200);
    expect(db.writes).toBe(1);
  });

  it('rejects malformed JSON with 400 rather than 500', async () => {
    const db = new MockDB();
    const res = await app.request('/api/state/save', post('{"tick":1,"dwarv'), env(db));

    expect(res.status).toBe(400);
    expect(db.writes).toBe(0);
  });
});

describe('GET /api/state/load with a corrupt world', () => {
  it('reports an error instead of "no save", so the client will not overwrite it', async () => {
    const db = new MockDB();
    db.storedRow = { state: '{"tick":1,"dwarv' };

    const res = await app.request('/api/state/load', {}, env(db));
    const payload = await res.json<any>();

    expect(res.status).toBe(500);
    expect(payload.corrupt).toBe(true);
    // The dangerous old behaviour was 200 + {state:null}, indistinguishable from a new game.
    expect(payload.state).toBeUndefined();
  });

  it('still reports a genuinely empty database as no save', async () => {
    const res = await app.request('/api/state/load', {}, env(new MockDB()));
    const payload = await res.json<any>();

    expect(res.status).toBe(200);
    expect(payload.state).toBeNull();
  });
});

describe('request shape validation', () => {
  it('rejects /api/decide when dwarves is not an array', async () => {
    const res = await app.request('/api/decide/simple', post({ resources: {} }), env(new MockDB()));

    expect(res.status).toBe(400);
    expect(routerMocks.routeDecision).not.toHaveBeenCalled();
  });

  it('rejects /api/backstory/batch when dwarves is a string', async () => {
    // 'oops'.slice(0,10) used to iterate characters and make four real model calls.
    const res = await app.request('/api/backstory/batch', post({ dwarves: 'oops' }), env(new MockDB()));

    expect(res.status).toBe(400);
    expect(routerMocks.generateBackstory).not.toHaveBeenCalled();
  });

  it('caps sponsorship claims so the query stays inside D1 bound-parameter limits', async () => {
    const db = new MockDB();
    const claims = Array.from({ length: 500 }, (_, i) => ({
      dwarfId: `d${i}`, claimToken: `token-${String(i).padStart(30, '0')}`,
    }));

    const res = await app.request('/api/decide/simple', post({ dwarves: [], sponsorshipClaims: claims }), env(db));

    expect(res.status).toBe(200);
    // 40 claims x 2 bound params = 80, under D1's 100 ceiling.
    expect(routerMocks.routeDecision).toHaveBeenCalled();
  });
});

describe('sponsorship billing', () => {
  const sponsored = (): Sponsorship => ({
    id: 1, dwarf_id: 'd1', ai_tier: 'premium', calls_remaining: 5,
    status: 'active', claim_token: 'claim-token-000000000000000000000001',
    created_at: '2026-08-01T00:00:00Z', activated_at: '2026-08-01T00:00:00Z',
  });
  const body = { dwarves: [], sponsorshipClaims: [{ dwarfId: 'd1', claimToken: 'claim-token-000000000000000000000001' }] };

  it('bills a paid call when a model actually answered', async () => {
    const db = new MockDB();
    db.sponsorships = [sponsored()];

    await app.request('/api/decide/simple', post(body), env(db));

    expect(db.sponsorships[0].calls_remaining).toBe(4);
  });

  it('does not bill when every model failed and local logic answered', async () => {
    routerMocks.routeDecision.mockResolvedValue({
      decisions: [], model: 'local-fallback', tokensIn: 0, tokensOut: 0, costCents: 0,
    });
    const db = new MockDB();
    db.sponsorships = [sponsored()];

    await app.request('/api/decide/simple', post(body), env(db));

    expect(db.sponsorships[0].calls_remaining).toBe(5);
  });
});
