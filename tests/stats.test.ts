import { describe, it, expect } from 'vitest';
import { roll3d6, generateDwarfStats, statModifier } from '../src/shared/stats';

describe('D&D Stat Generation', () => {
  describe('roll3d6', () => {
    it('returns a value between 3 and 18', () => {
      for (let i = 0; i < 1000; i++) {
        const roll = roll3d6();
        expect(roll).toBeGreaterThanOrEqual(3);
        expect(roll).toBeLessThanOrEqual(18);
      }
    });

    it('has an average close to 10.5', () => {
      let sum = 0;
      const n = 10000;
      for (let i = 0; i < n; i++) sum += roll3d6();
      const avg = sum / n;
      expect(avg).toBeGreaterThan(10.0);
      expect(avg).toBeLessThan(11.0);
    });

    it('produces a bell curve distribution', () => {
      const counts = new Array(19).fill(0); // indices 0-18, use 3-18
      const n = 100000;
      for (let i = 0; i < n; i++) counts[roll3d6()]++;

      // 10 and 11 should be the most common values
      const peak = Math.max(counts[10], counts[11]);
      // 3 and 18 should be rare (< 1%)
      expect(counts[3] / n).toBeLessThan(0.01);
      expect(counts[18] / n).toBeLessThan(0.01);
      // Peak should be > 10%
      expect(peak / n).toBeGreaterThan(0.10);
    });
  });

  describe('generateDwarfStats', () => {
    it('generates all 6 D&D stats', () => {
      const stats = generateDwarfStats();
      expect(stats.STR).toBeDefined();
      expect(stats.DEX).toBeDefined();
      expect(stats.CON).toBeDefined();
      expect(stats.INT).toBeDefined();
      expect(stats.WIS).toBeDefined();
      expect(stats.CHA).toBeDefined();
    });

    it('all stats are in valid range (3-18)', () => {
      for (let i = 0; i < 100; i++) {
        const stats = generateDwarfStats();
        for (const [key, val] of Object.entries(stats)) {
          if (['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(key)) {
            expect(val, `${key} out of range`).toBeGreaterThanOrEqual(3);
            expect(val, `${key} out of range`).toBeLessThanOrEqual(18);
          }
        }
      }
    });

    it('generates faith between 0-100', () => {
      for (let i = 0; i < 100; i++) {
        const stats = generateDwarfStats();
        expect(stats.faith).toBeGreaterThanOrEqual(0);
        expect(stats.faith).toBeLessThanOrEqual(100);
      }
    });

    it('generates morality between 0-100', () => {
      for (let i = 0; i < 100; i++) {
        const stats = generateDwarfStats();
        expect(stats.morality).toBeGreaterThanOrEqual(0);
        expect(stats.morality).toBeLessThanOrEqual(100);
      }
    });

    it('generates ambition between 0-100', () => {
      for (let i = 0; i < 100; i++) {
        const stats = generateDwarfStats();
        expect(stats.ambition).toBeGreaterThanOrEqual(0);
        expect(stats.ambition).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('statModifier', () => {
    it('returns negative modifier for low stats', () => {
      expect(statModifier(3)).toBeLessThan(1);
      expect(statModifier(6)).toBeLessThan(1);
      expect(statModifier(8)).toBeLessThan(1);
    });

    it('returns 1.0 for average stat (10-11)', () => {
      expect(statModifier(10)).toBeCloseTo(1.0, 1);
      expect(statModifier(11)).toBeCloseTo(1.0, 1);
    });

    it('returns positive modifier for high stats', () => {
      expect(statModifier(14)).toBeGreaterThan(1);
      expect(statModifier(18)).toBeGreaterThan(1);
    });

    it('modifier range is 0.5-1.5 for stats 3-18', () => {
      for (let s = 3; s <= 18; s++) {
        const mod = statModifier(s);
        expect(mod).toBeGreaterThanOrEqual(0.5);
        expect(mod).toBeLessThanOrEqual(1.5);
      }
    });

    it('higher stat always gives higher or equal modifier', () => {
      for (let s = 4; s <= 18; s++) {
        expect(statModifier(s)).toBeGreaterThanOrEqual(statModifier(s - 1));
      }
    });
  });
});
