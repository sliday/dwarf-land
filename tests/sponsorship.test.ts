import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simulate D1 sponsorship operations
function createMockDB() {
  const rows: any[] = [];

  return {
    rows,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: any[]) => ({
        run: async () => {
          if (sql.includes('INSERT INTO dwarf_sponsorships')) {
            const [dwarfId, checkoutId, tier, aiTier, callsRemaining, callsTotal, amountCents, status] = args;
            rows.push({
              id: rows.length + 1, dwarf_id: dwarfId, checkout_id: checkoutId,
              tier, ai_tier: aiTier, calls_remaining: callsRemaining,
              calls_total: callsTotal, amount_cents: amountCents, status,
              created_at: new Date().toISOString(), activated_at: null, expired_at: null,
            });
          }
          if (sql.includes('UPDATE dwarf_sponsorships SET status=\'active\'')) {
            const [checkoutId] = args;
            const row = rows.find(r => r.checkout_id === checkoutId && r.status === 'pending');
            if (row) { row.status = 'active'; row.activated_at = new Date().toISOString(); }
          }
          if (sql.includes('calls_remaining = calls_remaining - 1')) {
            const [dwarfId] = args;
            const row = rows.find(r => r.dwarf_id === dwarfId && r.status === 'active' && r.calls_remaining > 0);
            if (row) row.calls_remaining--;
          }
          if (sql.includes('SET status=\'expired\'')) {
            const [dwarfId] = args;
            const row = rows.find(r => r.dwarf_id === dwarfId && r.calls_remaining <= 0 && r.status === 'active');
            if (row) { row.status = 'expired'; row.expired_at = new Date().toISOString(); }
          }
        },
        first: async () => {
          if (sql.includes('SELECT * FROM dwarf_sponsorships')) {
            const [dwarfId] = args;
            return rows.find(r => r.dwarf_id === dwarfId && r.status === 'active' && r.calls_remaining > 0) || null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes('SELECT dwarf_id, ai_tier FROM dwarf_sponsorships')) {
            return { results: rows.filter(r => r.status === 'active' && r.calls_remaining > 0 && args.includes(r.dwarf_id)) };
          }
          return { results: [] };
        },
      }),
    })),
  };
}

describe('Sponsorship DB operations', () => {
  let db: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    db = createMockDB();
  });

  it('should insert a pending sponsorship', async () => {
    await db.prepare(
      'INSERT INTO dwarf_sponsorships (dwarf_id, checkout_id, tier, ai_tier, calls_remaining, calls_total, amount_cents, status) VALUES (?,?,?,?,?,?,?,?)'
    ).bind('dwarf-1', 'chk-001', 'bronze', 'medium', 100, 100, 100, 'pending').run();

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].status).toBe('pending');
    expect(db.rows[0].calls_remaining).toBe(100);
    expect(db.rows[0].ai_tier).toBe('medium');
  });

  it('should activate sponsorship on webhook', async () => {
    await db.prepare('INSERT INTO dwarf_sponsorships ...').bind('dwarf-1', 'chk-001', 'gold', 'premium', 100, 100, 1000, 'pending').run();

    await db.prepare(
      "UPDATE dwarf_sponsorships SET status='active', activated_at=datetime('now') WHERE checkout_id=? AND status='pending'"
    ).bind('chk-001').run();

    expect(db.rows[0].status).toBe('active');
    expect(db.rows[0].activated_at).toBeTruthy();
  });

  it('should decrement calls_remaining', async () => {
    await db.prepare('INSERT INTO dwarf_sponsorships ...').bind('dwarf-1', 'chk-001', 'silver', 'complex', 75, 75, 300, 'pending').run();
    await db.prepare("UPDATE dwarf_sponsorships SET status='active'...").bind('chk-001').run();

    await db.prepare(
      "UPDATE dwarf_sponsorships SET calls_remaining = calls_remaining - 1 WHERE dwarf_id=? AND status='active' AND calls_remaining > 0"
    ).bind('dwarf-1').run();

    expect(db.rows[0].calls_remaining).toBe(74);
  });

  it('should expire when calls hit 0', async () => {
    await db.prepare('INSERT INTO dwarf_sponsorships ...').bind('dwarf-1', 'chk-001', 'bronze', 'medium', 1, 1, 100, 'pending').run();
    await db.prepare("UPDATE dwarf_sponsorships SET status='active'...").bind('chk-001').run();

    // Decrement the last call
    await db.prepare(
      "UPDATE dwarf_sponsorships SET calls_remaining = calls_remaining - 1 WHERE dwarf_id=? AND status='active' AND calls_remaining > 0"
    ).bind('dwarf-1').run();

    expect(db.rows[0].calls_remaining).toBe(0);

    // Auto-expire
    await db.prepare(
      "UPDATE dwarf_sponsorships SET status='expired', expired_at=datetime('now') WHERE dwarf_id=? AND calls_remaining <= 0 AND status='active'"
    ).bind('dwarf-1').run();

    expect(db.rows[0].status).toBe('expired');
    expect(db.rows[0].expired_at).toBeTruthy();
  });

  it('should return active sponsorship for status check', async () => {
    await db.prepare('INSERT INTO dwarf_sponsorships ...').bind('dwarf-1', 'chk-001', 'gold', 'premium', 100, 100, 1000, 'pending').run();
    await db.prepare("UPDATE dwarf_sponsorships SET status='active'...").bind('chk-001').run();

    const result = await db.prepare(
      "SELECT * FROM dwarf_sponsorships WHERE dwarf_id=? AND status='active' AND calls_remaining > 0 ORDER BY created_at DESC LIMIT 1"
    ).bind('dwarf-1').first();

    expect(result).toBeTruthy();
    expect(result.tier).toBe('gold');
    expect(result.ai_tier).toBe('premium');
  });

  it('should return null for expired sponsorship', async () => {
    await db.prepare('INSERT INTO dwarf_sponsorships ...').bind('dwarf-1', 'chk-001', 'bronze', 'medium', 1, 1, 100, 'pending').run();
    await db.prepare("UPDATE dwarf_sponsorships SET status='active'...").bind('chk-001').run();
    await db.prepare("UPDATE dwarf_sponsorships SET calls_remaining = calls_remaining - 1...").bind('dwarf-1').run();
    await db.prepare("UPDATE dwarf_sponsorships SET status='expired'...").bind('dwarf-1').run();

    const result = await db.prepare(
      "SELECT * FROM dwarf_sponsorships WHERE dwarf_id=? AND status='active' AND calls_remaining > 0 ORDER BY created_at DESC LIMIT 1"
    ).bind('dwarf-1').first();

    expect(result).toBeNull();
  });

  it('should find sponsored dwarves in batch query', async () => {
    await db.prepare('INSERT INTO dwarf_sponsorships ...').bind('dwarf-1', 'chk-001', 'gold', 'premium', 100, 100, 1000, 'pending').run();
    await db.prepare("UPDATE dwarf_sponsorships SET status='active'...").bind('chk-001').run();

    const result = await db.prepare(
      "SELECT dwarf_id, ai_tier FROM dwarf_sponsorships WHERE dwarf_id IN (?,?) AND status='active' AND calls_remaining > 0"
    ).bind('dwarf-1', 'dwarf-2').all();

    expect(result.results).toHaveLength(1);
    expect(result.results[0].dwarf_id).toBe('dwarf-1');
    expect(result.results[0].ai_tier).toBe('premium');
  });
});
