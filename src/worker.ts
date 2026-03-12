import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Polar } from '@polar-sh/sdk';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import type { Env, Tier, GameState } from './shared/types';
import { routeDecision, generateBackstory, generateCraftResult } from './ai/router';
import { checkBudget, logUsage } from './guardrails/budget';
import { checkRateLimit } from './guardrails/rate-limiter';
import { saveState, loadState } from './db/state';

const SPONSOR_TIERS = {
  bronze: { amount: 100, aiTier: 'medium' as Tier, calls: 100 },
  silver: { amount: 300, aiTier: 'complex' as Tier, calls: 75 },
  gold:   { amount: 1000, aiTier: 'premium' as Tier, calls: 100 },
} as const;

type SponsorTier = keyof typeof SPONSOR_TIERS;

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();
app.use('/*', cors());

// Health / budget status
app.get('/api/health', async (c) => {
  const db = c.env.DB;
  const hour = new Date().toISOString().slice(0, 13).replace('T', '-');
  const rows = await db.prepare(
    'SELECT tier, calls, cost_cents FROM budget_log WHERE hour = ?'
  ).bind(hour).all();

  const caps: Record<string, number> = {
    simple: 50, medium: 100, complex: 200, premium: 500,
  };

  const tiers = ['simple', 'medium', 'complex', 'premium'].map((tier) => {
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
  return c.json({ ok: true, hour, tiers, totalCents, maxTotalCents: 850 });
});

// AI decision endpoint
app.post('/api/decide/:tier', async (c) => {
  const tier = c.req.param('tier') as Tier;
  if (!['simple', 'medium', 'complex', 'premium'].includes(tier)) {
    return c.json({ error: 'Invalid tier' }, 400);
  }

  const rateLimitOk = checkRateLimit(tier);
  if (!rateLimitOk) {
    return c.json({ error: 'Rate limited', fallback: true }, 429);
  }

  const budgetOk = await checkBudget(c.env.DB, tier);
  if (!budgetOk) {
    return c.json({ error: 'Budget exceeded', fallback: true }, 429);
  }

  try {
    const body = await c.req.json();

    // Check if any dwarf in the batch has an active sponsorship for a tier upgrade
    let effectiveTier = tier;
    const sponsoredDwarfIds: string[] = [];
    if (body.dwarves?.length) {
      const placeholders = body.dwarves.map(() => '?').join(',');
      const ids = body.dwarves.map((d: any) => d.id);
      const sponsored = await c.env.DB.prepare(
        `SELECT dwarf_id, ai_tier FROM dwarf_sponsorships WHERE dwarf_id IN (${placeholders}) AND status='active' AND calls_remaining > 0`
      ).bind(...ids).all();

      const tierRank: Record<string, number> = { simple: 0, medium: 1, complex: 2, premium: 3 };
      for (const row of (sponsored.results || []) as any[]) {
        sponsoredDwarfIds.push(row.dwarf_id);
        if (tierRank[row.ai_tier] > tierRank[effectiveTier]) {
          effectiveTier = row.ai_tier as Tier;
        }
      }
    }

    const result = await routeDecision(effectiveTier, body, c.env.OPENROUTER_API_KEY);

    await logUsage(c.env.DB, effectiveTier, result.model, result.tokensIn, result.tokensOut, result.costCents);

    // Decrement calls for sponsored dwarves
    for (const dwarfId of sponsoredDwarfIds) {
      await c.env.DB.prepare(
        "UPDATE dwarf_sponsorships SET calls_remaining = calls_remaining - 1 WHERE dwarf_id=? AND status='active' AND calls_remaining > 0"
      ).bind(dwarfId).run();
      await c.env.DB.prepare(
        "UPDATE dwarf_sponsorships SET status='expired', expired_at=datetime('now') WHERE dwarf_id=? AND calls_remaining <= 0 AND status='active'"
      ).bind(dwarfId).run();
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
    const state: GameState = await c.req.json();
    await saveState(c.env.DB, state);
    return c.json({ ok: true });
  } catch (err: any) {
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
    console.error('Load state error:', err?.message || err);
    return c.json({ error: 'Load failed' }, 500);
  }
});

// Backstory generation (MEDIUM tier)
app.post('/api/backstory', async (c) => {
  const rateLimitOk = checkRateLimit('medium');
  if (!rateLimitOk) return c.json({ error: 'Rate limited' }, 429);

  const budgetOk = await checkBudget(c.env.DB, 'medium');
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

// --- Crafting endpoint ---
app.post('/api/craft', async (c) => {
  const rateLimitOk = checkRateLimit('simple');
  if (!rateLimitOk) return c.json({ error: 'Rate limited' }, 429);

  try {
    const { item1, item2 } = await c.req.json<{
      item1: { emoji: string; name: string };
      item2: { emoji: string; name: string };
    }>();

    if (!item1?.name || !item2?.name) {
      return c.json({ error: 'Invalid items' }, 400);
    }

    const db = c.env.DB;

    // Normalize: sort by name so A+B = B+A
    const [a, b] = [item1, item2].sort((x, y) => x.name.localeCompare(y.name));

    // Ensure both items exist in DB (insert if not)
    const ensureItem = async (emoji: string, name: string): Promise<number> => {
      const existing = await db.prepare('SELECT id FROM craft_items WHERE name = ?').bind(name).first<{ id: number }>();
      if (existing) return existing.id;
      const res = await db.prepare('INSERT INTO craft_items (emoji, name, depth) VALUES (?, ?, 99)').bind(emoji, name).run();
      return res.meta.last_row_id as number;
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
    const budgetOk = await checkBudget(db, 'simple');
    if (!budgetOk) return c.json({ error: 'Budget exceeded' }, 429);

    const aiResult = await generateCraftResult(a, b, c.env.OPENROUTER_API_KEY);
    await logUsage(db, 'simple', aiResult.model, aiResult.tokensIn, aiResult.tokensOut, aiResult.costCents);

    // Store result item + recipe
    const resultId = await ensureItem(aiResult.emoji, aiResult.name);
    await db.prepare(
      'INSERT OR IGNORE INTO craft_recipes (item_a_id, item_b_id, result_id, source) VALUES (?, ?, ?, ?)'
    ).bind(lowId, highId, resultId, 'ai').run();

    return c.json({
      ok: true,
      result: { emoji: aiResult.emoji, name: aiResult.name, isNew: true },
      source: 'ai',
      costCents: aiResult.costCents,
      model: aiResult.model,
    });
  } catch (err: any) {
    console.error('Craft error:', err?.message || err);
    return c.json({ error: 'Craft failed' }, 500);
  }
});

// Religion generation (Phase 4 placeholder)
app.post('/api/religion', async (c) => {
  return c.json({ error: 'Not implemented yet' }, 501);
});

// --- Sponsorship endpoints ---

app.post('/api/sponsor/checkout', async (c) => {
  const { dwarfId, tier } = await c.req.json<{ dwarfId: string; tier: string }>();
  if (!dwarfId || !(tier in SPONSOR_TIERS)) {
    return c.json({ error: 'Invalid dwarfId or tier' }, 400);
  }

  const config = SPONSOR_TIERS[tier as SponsorTier];
  const polar = new Polar({ accessToken: c.env.POLAR_ACCESS_TOKEN });

  const checkout = await polar.checkouts.create({
    products: ['b1004307-cc24-45c8-8211-52e319403bea'],
    amount: config.amount,
    successUrl: 'https://dwarf.land/success?checkout_id={CHECKOUT_ID}',
    metadata: { dwarfId, tier },
  });

  await c.env.DB.prepare(
    'INSERT INTO dwarf_sponsorships (dwarf_id, checkout_id, tier, ai_tier, calls_remaining, calls_total, amount_cents, status) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(
    dwarfId, checkout.id, tier,
    config.aiTier, config.calls, config.calls,
    config.amount, 'pending'
  ).run();

  return c.json({ checkoutUrl: checkout.url });
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
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return c.text('Invalid signature', 403);
    }
    throw err;
  }
});

app.get('/api/sponsor/total', async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) as total FROM dwarf_sponsorships WHERE status IN ('active','expired')"
  ).first<{ total: number }>();
  return c.json({ totalCents: row?.total ?? 0 });
});

app.get('/api/sponsor/status/:dwarfId', async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT * FROM dwarf_sponsorships WHERE dwarf_id=? AND status='active' AND calls_remaining > 0 ORDER BY created_at DESC LIMIT 1"
  ).bind(c.req.param('dwarfId')).first();
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
  // Auto-activate: user landed here = Polar charged them
  if (checkoutId) {
    try {
      await c.env.DB.prepare(
        "UPDATE dwarf_sponsorships SET status='active', activated_at=datetime('now') WHERE checkout_id=? AND status='pending'"
      ).bind(checkoutId).run();
    } catch (_) { /* best-effort */ }
  }
  return c.html(`<!DOCTYPE html>
<html lang="en" data-theme="grunge">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sponsorship Complete - Dwarf Land</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daub-ui@latest/daub.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧔</text></svg>">
<style>body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace}</style>
</head>
<body>
<div class="db-card" style="max-width:480px;text-align:center;padding:32px">
  <div style="font-size:64px;margin-bottom:16px">⭐</div>
  <h1 class="db-h3" style="margin-bottom:8px">Brain Upgraded!</h1>
  <p class="db-body" style="margin-bottom:24px">Your sponsored dwarf now has enhanced AI reasoning. They'll make smarter decisions for a limited number of turns.</p>
  <p class="db-caption" style="margin-bottom:24px;opacity:0.6">Checkout: ${checkoutId.slice(0, 8)}...</p>
  <a href="/" class="db-btn db-btn--primary">Return to Dwarf Land</a>
</div>
</body>
</html>`);
});

export default app;
