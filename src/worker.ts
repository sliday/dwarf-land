import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Polar } from '@polar-sh/sdk';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import type { Env, Tier, GameState } from './shared/types';
import { routeDecision, generateBackstory, generateCraftResult, generateEpitaph } from './ai/router';
import { checkBudget, getProjectedCostCents, logUsage, MAX_CENTS_PER_HOUR, MAX_TOTAL_CENTS_PER_HOUR } from './guardrails/budget';
import { checkRateLimit } from './guardrails/rate-limiter';
import { saveState, loadState, MAX_STATE_BYTES, StateTooLargeError, StateCorruptError } from './db/state';

const SPONSOR_TIERS = {
  bronze: { amount: 100, aiTier: 'medium' as Tier, calls: 100 },
  silver: { amount: 300, aiTier: 'complex' as Tier, calls: 75 },
  gold:   { amount: 1000, aiTier: 'premium' as Tier, calls: 100 },
} as const;

// Fallback keeps the deployed store working when POLAR_PRODUCT_ID is unset; a fork should
// set the var to its own product rather than edit this line.
const DEFAULT_POLAR_PRODUCT_ID = 'b1004307-cc24-45c8-8211-52e319403bea';

type SponsorTier = keyof typeof SPONSOR_TIERS;
type ActiveSponsorshipRow = {
  id: number;
  dwarf_id: string;
  ai_tier: Tier;
  created_at: string | null;
  activated_at: string | null;
};
type SponsorshipClaim = { dwarfId: string; claimToken: string };

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();
function isAllowedOrigin(c: any, origin?: string | null): boolean {
  if (!origin) return false;
  const selfOrigin = new URL(c.req.url).origin;
  return origin === selfOrigin;
}

app.use('/*', cors({
  origin: (origin, c) => isAllowedOrigin(c, origin) ? origin : undefined,
  allowHeaders: ['Content-Type', 'X-State-Write-Token'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

const TIER_RANK: Record<Tier, number> = { simple: 0, medium: 1, complex: 2, premium: 3 };

// Length caps for user-supplied strings. These bound three things at once: rows written to
// D1 by public endpoints, the size of text interpolated into model prompts, and the blast
// radius of a prompt-injection attempt.
const MAX_DWARF_ID_LEN = 64;
const MAX_ITEM_NAME_LEN = 50;
const MAX_EMOJI_LEN = 16;
const MAX_DWARF_NAME_LEN = 60;
const MAX_CAUSE_LEN = 80;
// Two bound parameters per claim against D1's 100-parameter ceiling.
const MAX_SPONSORSHIP_CLAIMS = 40;
// One prompt is built from this list; an uncapped body could bill far more than the
// per-call projection the budget guard assumes.
const MAX_DWARVES_PER_DECISION = 200;
const MAX_BACKSTORY_BATCH = 10;

/** Trim a value to a bounded single-line string, or null when it is not a usable string. */
function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

function compareSponsorshipRows(a: ActiveSponsorshipRow, b: ActiveSponsorshipRow): number {
  const tierDiff = TIER_RANK[a.ai_tier] - TIER_RANK[b.ai_tier];
  if (tierDiff !== 0) return tierDiff;
  const aTime = a.activated_at ?? a.created_at ?? '';
  const bTime = b.activated_at ?? b.created_at ?? '';
  const timeDiff = aTime.localeCompare(bTime);
  if (timeDiff !== 0) return timeDiff;
  return a.id - b.id;
}

function selectEffectiveSponsorships(rows: ActiveSponsorshipRow[]): ActiveSponsorshipRow[] {
  const selected = new Map<string, ActiveSponsorshipRow>();
  for (const row of rows) {
    const current = selected.get(row.dwarf_id);
    if (!current || compareSponsorshipRows(row, current) > 0) {
      selected.set(row.dwarf_id, row);
    }
  }
  return [...selected.values()];
}

function generateClaimToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function collectSponsorshipClaims(body: any): SponsorshipClaim[] {
  const rawClaims = Array.isArray(body?.sponsorshipClaims) ? body.sponsorshipClaims : [];
  const claims = rawClaims
    .map((claim: any) => ({ dwarfId: claim?.dwarfId, claimToken: claim?.claimToken }))
    .filter((claim: SponsorshipClaim) => typeof claim.dwarfId === 'string' && claim.dwarfId.length > 0 && typeof claim.claimToken === 'string' && claim.claimToken.length >= 32);
  const selected = new Map<string, SponsorshipClaim>();
  for (const claim of claims) selected.set(claim.dwarfId, claim);
  // D1 allows at most 100 bound parameters per query and each claim binds two, so an
  // uncapped list turned a large colony (or any caller) into a permanent 500 on /api/decide.
  return [...selected.values()].slice(0, MAX_SPONSORSHIP_CLAIMS);
}

async function loadActiveSponsorships(db: D1Database, claims: SponsorshipClaim[]): Promise<ActiveSponsorshipRow[]> {
  if (!claims.length) return [];
  const predicate = claims.map(() => '(dwarf_id=? AND claim_token=?)').join(' OR ');
  const values = claims.flatMap((claim) => [claim.dwarfId, claim.claimToken]);
  const sponsored = await db.prepare(
    `SELECT id, dwarf_id, ai_tier, created_at, activated_at FROM dwarf_sponsorships WHERE (${predicate}) AND status='active' AND calls_remaining > 0`
  ).bind(...values).all();
  return selectEffectiveSponsorships((sponsored.results || []) as ActiveSponsorshipRow[]);
}

// Health / budget status
app.get('/api/health', async (c) => {
  const db = c.env.DB;
  const hour = new Date().toISOString().slice(0, 13).replace('T', '-');
  const rows = await db.prepare(
    'SELECT tier, calls, cost_cents FROM budget_log WHERE hour = ?'
  ).bind(hour).all();

  const caps = MAX_CENTS_PER_HOUR;

  const tiers = (['simple', 'medium', 'complex', 'premium'] as Tier[]).map((tier) => {
    const row = rows.results?.find((r: any) => r.tier === tier);
    return {
      tier,
      hour,
      calls: (row as any)?.calls ?? 0,
      costCents: (row as any)?.cost_cents ?? 0,
      maxCentsPerHour: caps[tier],
      remaining: caps[tier] - ((row as any)?.cost_cents ?? 0),
    };
  });

  const totalCents = tiers.reduce((s, t) => s + t.costCents, 0);
  return c.json({ ok: true, hour, tiers, totalCents, maxTotalCents: MAX_TOTAL_CENTS_PER_HOUR });
});

// AI decision endpoint
app.post('/api/decide/:tier', async (c) => {
  const tier = c.req.param('tier') as Tier;
  if (!['simple', 'medium', 'complex', 'premium'].includes(tier)) {
    return c.json({ error: 'Invalid tier' }, 400);
  }

  try {
    const body = await c.req.json<any>();
    if (!body || typeof body !== 'object' || !Array.isArray(body.dwarves)) {
      // buildPrompt() maps over body.dwarves outside routeDecision's try, so a malformed
      // body used to surface as a 500 "AI call failed" that the client retried forever.
      return c.json({ error: 'Invalid body: dwarves must be an array' }, 400);
    }
    if (body.dwarves.length > MAX_DWARVES_PER_DECISION) {
      body.dwarves = body.dwarves.slice(0, MAX_DWARVES_PER_DECISION);
    }
    let effectiveTier = tier;
    const activeSponsorships = await loadActiveSponsorships(c.env.DB, collectSponsorshipClaims(body));
    const sponsoredDwarfIds = activeSponsorships.map((row) => row.dwarf_id);
    for (const row of activeSponsorships) {
      if (TIER_RANK[row.ai_tier] > TIER_RANK[effectiveTier]) {
        effectiveTier = row.ai_tier;
      }
    }

    const rateLimitOk = checkRateLimit(effectiveTier);
    if (!rateLimitOk) {
      return c.json({ error: 'Rate limited', fallback: true }, 429);
    }

    const budgetOk = await checkBudget(c.env.DB, effectiveTier, getProjectedCostCents(effectiveTier));
    if (!budgetOk) {
      return c.json({ error: 'Budget exceeded', fallback: true }, 429);
    }

    const result = await routeDecision(effectiveTier, body, c.env.OPENROUTER_API_KEY);

    await logUsage(c.env.DB, effectiveTier, result.model, result.tokensIn, result.tokensOut, result.costCents);

    // Do not bill a sponsor when every model failed and local logic answered. A gold
    // sponsor could otherwise burn all 100 premium calls during an OpenRouter outage
    // and receive no AI output at all.
    const billSponsorships = result.model !== 'local-fallback';
    for (const sponsorship of billSponsorships ? activeSponsorships : []) {
      await c.env.DB.prepare(
        "UPDATE dwarf_sponsorships SET calls_remaining = calls_remaining - 1 WHERE id=? AND status='active' AND calls_remaining > 0"
      ).bind(sponsorship.id).run();
      await c.env.DB.prepare(
        "UPDATE dwarf_sponsorships SET status='expired', expired_at=datetime('now') WHERE id=? AND calls_remaining <= 0 AND status='active'"
      ).bind(sponsorship.id).run();
    }

    return c.json({
      ok: true,
      decisions: result.decisions,
      model: result.model,
      costCents: result.costCents,
      sponsoredDwarfIds,
    });
  } catch (err: any) {
    console.error(`AI decision error (${tier}):`, err?.message || err);
    return c.json({ error: 'AI call failed', fallback: true }, 500);
  }
});

// State persistence
app.post('/api/state/save', async (c) => {
  try {
    const origin = c.req.header('origin');
    const token = c.req.header('x-state-write-token');
    if (!isAllowedOrigin(c, origin) && (!c.env.STATE_WRITE_TOKEN || token !== c.env.STATE_WRITE_TOKEN)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    // Read the real bytes rather than trusting Content-Length, which the caller controls
    // and a chunked body may omit entirely.
    const raw = await c.req.arrayBuffer();
    if (raw.byteLength > MAX_STATE_BYTES) {
      return c.json({ error: 'Payload too large', maxBytes: MAX_STATE_BYTES, bytes: raw.byteLength }, 413);
    }
    let state: GameState;
    try {
      state = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return c.json({ error: 'Malformed state' }, 400);
    }
    await saveState(c.env.DB, state);
    return c.json({ ok: true });
  } catch (err: any) {
    if (err instanceof StateTooLargeError) {
      console.error('Save state rejected:', err.message);
      return c.json({ error: 'Payload too large', maxBytes: MAX_STATE_BYTES, bytes: err.bytes }, 413);
    }
    console.error('Save state error:', err?.message || err);
    return c.json({ error: 'Save failed' }, 500);
  }
});

app.get('/api/state/load', async (c) => {
  try {
    const state = await loadState(c.env.DB);
    if (!state) return c.json({ ok: true, state: null });
    return c.json({ ok: true, state });
  } catch (err: any) {
    if (err instanceof StateCorruptError) {
      // Explicitly NOT {state:null}: that reads as "new game" and the client would
      // overwrite a recoverable world on its next autosave.
      console.error('Load state error: stored world is corrupt');
      return c.json({ error: 'Stored state is corrupt', corrupt: true }, 500);
    }
    console.error('Load state error:', err?.message || err);
    return c.json({ error: 'Load failed' }, 500);
  }
});

// Backstory generation (MEDIUM tier)
app.post('/api/backstory', async (c) => {
  const rateLimitOk = checkRateLimit('medium');
  if (!rateLimitOk) return c.json({ error: 'Rate limited' }, 429);

  const budgetOk = await checkBudget(c.env.DB, 'medium', getProjectedCostCents('medium'));
  if (!budgetOk) return c.json({ error: 'Budget exceeded' }, 429);

  try {
    const body = await c.req.json();
    const result = await generateBackstory(body, c.env.OPENROUTER_API_KEY);
    await logUsage(c.env.DB, 'medium', result.model, result.tokensIn, result.tokensOut, result.costCents);
    return c.json({ ok: true, ...result.backstory, model: result.model, costCents: result.costCents });
  } catch (err: any) {
    console.error('Backstory error:', err?.message || err);
    return c.json({ error: 'Backstory generation failed' }, 500);
  }
});

// Batch backstory generation (up to 10 at once, single rate limit check)
app.post('/api/backstory/batch', async (c) => {
  const rateLimitOk = checkRateLimit('medium');
  if (!rateLimitOk) return c.json({ error: 'Rate limited' }, 429);

  try {
    const { dwarves } = await c.req.json<{ dwarves: any[] }>();
    // Without the Array check a string body iterated per character, producing real model
    // calls for 'o','o','p','s'.
    if (!Array.isArray(dwarves)) {
      return c.json({ error: 'Invalid body: dwarves must be an array' }, 400);
    }
    const batch = dwarves.slice(0, MAX_BACKSTORY_BATCH);
    const budgetOk = await checkBudget(c.env.DB, 'medium', getProjectedCostCents('medium', batch.length));
    if (!budgetOk) return c.json({ error: 'Budget exceeded' }, 429);
    const results: any[] = [];
    for (const dwarf of batch) {
      try {
        const result = await generateBackstory(dwarf, c.env.OPENROUTER_API_KEY);
        await logUsage(c.env.DB, 'medium', result.model, result.tokensIn, result.tokensOut, result.costCents);
        results.push({ id: dwarf.id, ...result.backstory });
      } catch (e) {
        results.push({ id: dwarf.id, error: true });
      }
    }
    return c.json({ ok: true, results });
  } catch (err: any) {
    console.error('Batch backstory error:', err?.message || err);
    return c.json({ error: 'Batch backstory failed' }, 500);
  }
});

// --- Crafting endpoint ---
app.post('/api/craft', async (c) => {
  const rateLimitOk = checkRateLimit('simple');
  if (!rateLimitOk) return c.json({ error: 'Rate limited' }, 429);

  try {
    const { item1, item2 } = await c.req.json<{
      item1: { emoji: string; name: string };
      item2: { emoji: string; name: string };
    }>();

    // Both items land in craft_items verbatim, so bound them before they reach D1.
    const name1 = cleanString(item1?.name, MAX_ITEM_NAME_LEN);
    const name2 = cleanString(item2?.name, MAX_ITEM_NAME_LEN);
    const emoji1 = cleanString(item1?.emoji, MAX_EMOJI_LEN) ?? '❓';
    const emoji2 = cleanString(item2?.emoji, MAX_EMOJI_LEN) ?? '❓';
    if (!name1 || !name2) {
      return c.json({ error: 'Invalid items' }, 400);
    }

    const db = c.env.DB;

    // Normalize: sort by name so A+B = B+A
    const [a, b] = [
      { emoji: emoji1, name: name1 },
      { emoji: emoji2, name: name2 },
    ].sort((x, y) => x.name.localeCompare(y.name));

    // Ensure both items exist in DB (insert if not)
    // craft_items.name is UNIQUE, so the old select-then-insert returned a 500 whenever
    // two players crafted the same new item at once. Let the database resolve the race.
    const ensureItem = async (emoji: string, name: string): Promise<number> => {
      const existing = await db.prepare('SELECT id FROM craft_items WHERE name = ?').bind(name).first<{ id: number }>();
      if (existing) return existing.id;
      const inserted = await db.prepare(
        'INSERT INTO craft_items (emoji, name, depth) VALUES (?, ?, 99) ON CONFLICT(name) DO NOTHING RETURNING id'
      ).bind(emoji, name).first<{ id: number }>();
      if (inserted?.id != null) return inserted.id;
      // DO NOTHING fired: another request inserted it between our select and insert.
      const raced = await db.prepare('SELECT id FROM craft_items WHERE name = ?').bind(name).first<{ id: number }>();
      if (raced) return raced.id;
      throw new Error(`craft_items row for ${name} vanished after conflict`);
    };

    const aId = await ensureItem(a.emoji, a.name);
    const bId = await ensureItem(b.emoji, b.name);

    // Normalize IDs for lookup
    const lowId = Math.min(aId, bId);
    const highId = Math.max(aId, bId);

    // Check cache
    const cached = await db.prepare(
      'SELECT r.result_id, i.emoji, i.name FROM craft_recipes r JOIN craft_items i ON i.id = r.result_id WHERE r.item_a_id = ? AND r.item_b_id = ?'
    ).bind(lowId, highId).first<{ result_id: number; emoji: string; name: string }>();

    if (cached) {
      return c.json({
        ok: true,
        result: { emoji: cached.emoji, name: cached.name, isNew: false },
        source: 'cache',
        costCents: 0,
      });
    }

    // Not cached — call AI
    const budgetOk = await checkBudget(db, 'simple', getProjectedCostCents('simple'));
    if (!budgetOk) return c.json({ error: 'Budget exceeded' }, 429);

    const aiResult = await generateCraftResult(a, b, c.env.OPENROUTER_API_KEY);
    await logUsage(db, 'simple', aiResult.model, aiResult.tokensIn, aiResult.tokensOut, aiResult.costCents);

    // Store result item + recipe. The model's output is untrusted too, so bound it the
    // same way as the request items before it becomes a permanent cache entry.
    const resultName = cleanString(aiResult.name, MAX_ITEM_NAME_LEN);
    const resultEmoji = cleanString(aiResult.emoji, MAX_EMOJI_LEN) ?? '❓';
    if (!resultName) return c.json({ error: 'Craft failed' }, 502);
    const resultId = await ensureItem(resultEmoji, resultName);
    await db.prepare(
      'INSERT OR IGNORE INTO craft_recipes (item_a_id, item_b_id, result_id, source) VALUES (?, ?, ?, ?)'
    ).bind(lowId, highId, resultId, 'ai').run();

    return c.json({
      ok: true,
      result: { emoji: resultEmoji, name: resultName, isNew: true },
      source: 'ai',
      costCents: aiResult.costCents,
      model: aiResult.model,
    });
  } catch (err: any) {
    console.error('Craft error:', err?.message || err);
    return c.json({ error: 'Craft failed' }, 500);
  }
});

// Epitaph generation — gravestone inscription
app.post('/api/epitaph', async (c) => {
  const rateLimitOk = checkRateLimit('simple');
  if (!rateLimitOk) return c.json({ error: 'Rate limited' }, 429);

  const budgetOk = await checkBudget(c.env.DB, 'simple', getProjectedCostCents('simple'));
  if (!budgetOk) return c.json({ error: 'Budget exceeded' }, 429);

  try {
    const body = await c.req.json<{ name: string; cause: string; age: number; cityName?: string }>();
    const name = cleanString(body?.name, MAX_DWARF_NAME_LEN);
    if (!name) return c.json({ error: 'Missing name' }, 400);
    // Every field below is interpolated into a prompt, so normalize rather than pass through.
    const result = await generateEpitaph({
      name,
      cause: cleanString(body?.cause, MAX_CAUSE_LEN) ?? 'died of unknown causes',
      age: Number.isFinite(body?.age) ? Math.trunc(body.age) : 0,
      cityName: cleanString(body?.cityName, MAX_DWARF_NAME_LEN) ?? undefined,
    }, c.env.OPENROUTER_API_KEY);
    await logUsage(c.env.DB, 'simple', result.model, result.tokensIn, result.tokensOut, result.costCents);
    return c.json({ ok: true, epitaph: result.epitaph, model: result.model, costCents: result.costCents });
  } catch (err: any) {
    console.error('Epitaph error:', err?.message || err);
    return c.json({ error: 'Epitaph generation failed' }, 500);
  }
});

// Religion generation (Phase 4 placeholder)
app.post('/api/religion', async (c) => {
  return c.json({ error: 'Not implemented yet' }, 501);
});

// --- Sponsorship endpoints ---

app.post('/api/sponsor/checkout', async (c) => {
  try {
    const { dwarfId, tier } = await c.req.json<{ dwarfId: string; tier: string }>();
    const cleanDwarfId = cleanString(dwarfId, MAX_DWARF_ID_LEN);
    if (!cleanDwarfId || typeof tier !== 'string' || !(tier in SPONSOR_TIERS)) {
      return c.json({ error: 'Invalid dwarfId or tier' }, 400);
    }

    const config = SPONSOR_TIERS[tier as SponsorTier];
    const polar = new Polar({ accessToken: c.env.POLAR_ACCESS_TOKEN });

    const checkout = await polar.checkouts.create({
      products: [c.env.POLAR_PRODUCT_ID || DEFAULT_POLAR_PRODUCT_ID],
      amount: config.amount,
      successUrl: `${new URL(c.req.url).origin}/success?checkout_id={CHECKOUT_ID}`,
      metadata: { dwarfId: cleanDwarfId, tier },
    });

    const claimToken = generateClaimToken();
    await c.env.DB.prepare(
      'INSERT INTO dwarf_sponsorships (dwarf_id, checkout_id, tier, ai_tier, calls_remaining, calls_total, amount_cents, status, claim_token) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(
      cleanDwarfId, checkout.id, tier,
      config.aiTier, config.calls, config.calls,
      config.amount, 'pending', claimToken
    ).run();

    return c.json({ checkoutUrl: checkout.url, claimToken });
  } catch (err: any) {
    console.error('Sponsor checkout error:', err?.message || err);
    return c.json({ error: 'Checkout failed' }, 502);
  }
});

app.post('/api/sponsor/webhook', async (c) => {
  const body = await c.req.text();
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => { headers[k] = v; });

  try {
    const event = validateEvent(body, headers, c.env.POLAR_WEBHOOK_SECRET);

    if (event.type === 'order.paid') {
      const checkoutId = (event.data as any).checkoutId || (event.data as any).checkout_id;
      if (checkoutId) {
        await c.env.DB.prepare(
          "UPDATE dwarf_sponsorships SET status='active', activated_at=datetime('now') WHERE checkout_id=? AND status='pending'"
        ).bind(checkoutId).run();
      }
    }

    return c.text('ok');
  } catch (err: any) {
    if (err instanceof WebhookVerificationError) {
      return c.text('Invalid signature', 403);
    }
    // Anything else used to rethrow into a bare 500 with no log line, which is how a
    // missing Buffer global hid here: Polar retried, gave up, and every sponsorship
    // stayed 'pending' forever with nobody watching.
    console.error('Sponsor webhook error:', err?.stack || err?.message || err);
    return c.text('Webhook handler error', 500);
  }
});

app.get('/api/sponsor/total', async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM dwarf_sponsorships WHERE status IN ('active','expired')"
  ).first<{ total: number }>();
  return c.json({ totalCents: row?.total ?? 0 });
});

app.get('/api/sponsor/status/:dwarfId', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, dwarf_id, tier, ai_tier, calls_remaining, calls_total, amount_cents, status, created_at, activated_at, expired_at FROM dwarf_sponsorships WHERE dwarf_id=? AND status='active' AND calls_remaining > 0"
  ).bind(c.req.param('dwarfId')).all();
  const [row] = selectEffectiveSponsorships((rows.results || []) as ActiveSponsorshipRow[]);
  return c.json({ sponsorship: row || null });
});

app.get('/api/sponsor/list', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT dwarf_id, tier, ai_tier, calls_remaining, calls_total, amount_cents, status, created_at FROM dwarf_sponsorships WHERE status IN ('active','expired') ORDER BY created_at DESC"
  ).all();
  return c.json({ sponsorships: rows.results || [] });
});

// Success page for sponsorship checkout completion
app.get('/success', async (c) => {
  const checkoutId = c.req.query('checkout_id') || '';
  let dwarfId = '';
  if (checkoutId) {
    try {
      const row = await c.env.DB.prepare(
        "SELECT dwarf_id FROM dwarf_sponsorships WHERE checkout_id=?"
      ).bind(checkoutId).first<{ dwarf_id: string }>();
      if (row) dwarfId = row.dwarf_id;
    } catch (_) { /* best-effort */ }
  }
  const returnUrl = dwarfId ? `/?dwarfId=${encodeURIComponent(dwarfId)}` : '/';
  return c.html(`<!DOCTYPE html>
<html lang="en" data-theme="grunge">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sponsorship Received - Dwarf Land</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daub-ui@3.19.12/daub.css" integrity="sha384-lqMQEdChfpz5OrhS1k2uryuRVI14A3JdzFYJ7vCHkG1FaTt2X2ypiApGuqQ9Qxmu" crossorigin="anonymous">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧔</text></svg>">
<style>body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace}</style>
</head>
<body>
<div class="db-card" style="max-width:480px;text-align:center;padding:32px">
  <div style="font-size:64px;margin-bottom:16px">⭐</div>
  <h1 class="db-h3" style="margin-bottom:8px">Sponsorship Received</h1>
  <p class="db-body" style="margin-bottom:24px">Polar still needs to confirm the payment. The verified webhook will activate your dwarf's AI upgrade as soon as that check lands.</p>
  <p class="db-caption" style="margin-bottom:24px;opacity:0.6">Checkout: ${escapeHtml(checkoutId.slice(0, 8))}...</p>
  <a href="${returnUrl}" class="db-btn db-btn--primary">Return to Dwarf Land</a>
</div>
</body>
</html>`);
});

export default app;
