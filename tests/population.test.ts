import { describe, it, expect } from 'vitest';
import {
  shouldAllowBirth,
  shouldSpawnReplacement,
  oldAgeDeathChance,
  starvationDeathChance,
  POP_HARD_CAP,
  POP_SOFT_CAP,
  POP_MINIMUM,
} from '../src/guardrails/population';

describe('Population Equilibrium', () => {
  describe('constants', () => {
    it('hard cap is 50', () => {
      expect(POP_HARD_CAP).toBe(50);
    });

    it('soft cap is 30', () => {
      expect(POP_SOFT_CAP).toBe(30);
    });

    it('minimum is 3', () => {
      expect(POP_MINIMUM).toBe(3);
    });
  });

  describe('shouldAllowBirth', () => {
    it('blocks births at hard cap (50)', () => {
      for (let i = 0; i < 100; i++) {
        expect(shouldAllowBirth(50)).toBe(false);
      }
    });

    it('blocks births above hard cap', () => {
      expect(shouldAllowBirth(51)).toBe(false);
      expect(shouldAllowBirth(100)).toBe(false);
    });

    it('always allows births below soft cap (30)', () => {
      for (let i = 0; i < 100; i++) {
        expect(shouldAllowBirth(10)).toBe(true);
        expect(shouldAllowBirth(29)).toBe(true);
      }
    });

    it('allows births between soft and hard cap with ~20% probability', () => {
      let allowed = 0;
      const trials = 10000;
      for (let i = 0; i < trials; i++) {
        if (shouldAllowBirth(35)) allowed++;
      }
      const rate = allowed / trials;
      // Should be around 0.2 (20%), allow ±5% tolerance
      expect(rate).toBeGreaterThan(0.15);
      expect(rate).toBeLessThan(0.25);
    });
  });

  describe('shouldSpawnReplacement', () => {
    it('spawns replacement when below minimum (3)', () => {
      expect(shouldSpawnReplacement(0)).toBe(true);
      expect(shouldSpawnReplacement(1)).toBe(true);
      expect(shouldSpawnReplacement(2)).toBe(true);
    });

    it('does not spawn replacement at or above minimum', () => {
      expect(shouldSpawnReplacement(3)).toBe(false);
      expect(shouldSpawnReplacement(10)).toBe(false);
      expect(shouldSpawnReplacement(50)).toBe(false);
    });
  });

  describe('oldAgeDeathChance', () => {
    it('returns 0 for dwarves 80 or younger', () => {
      expect(oldAgeDeathChance(1)).toBe(0);
      expect(oldAgeDeathChance(40)).toBe(0);
      expect(oldAgeDeathChance(80)).toBe(0);
    });

    it('returns 2% for dwarves over 80', () => {
      expect(oldAgeDeathChance(81)).toBe(0.02);
      expect(oldAgeDeathChance(100)).toBe(0.02);
      expect(oldAgeDeathChance(150)).toBe(0.02);
    });
  });

  describe('starvationDeathChance', () => {
    it('returns 0 when hunger > 0', () => {
      expect(starvationDeathChance(1)).toBe(0);
      expect(starvationDeathChance(50)).toBe(0);
      expect(starvationDeathChance(100)).toBe(0);
    });

    it('returns 10% when hunger is 0', () => {
      expect(starvationDeathChance(0)).toBe(0.10);
    });
  });

  describe('balance: population convergence simulation', () => {
    it('population stabilizes between soft cap and hard cap', () => {
      let pop = 7; // starting population
      const ticks = 10000;
      let maxPop = pop;
      let minPop = pop;

      for (let t = 0; t < ticks; t++) {
        // Simulate births (every ~100 ticks a birth attempt)
        if (t % 100 === 0 && shouldAllowBirth(pop)) {
          pop++;
        }

        // Simulate deaths (starvation at 1% chance, old age at 0.5%)
        if (pop > 0 && Math.random() < 0.005) {
          pop--;
        }

        // Spawn replacements
        if (shouldSpawnReplacement(pop)) {
          pop++;
        }

        maxPop = Math.max(maxPop, pop);
        minPop = Math.min(minPop, pop);
      }

      // Population should never exceed hard cap
      expect(maxPop).toBeLessThanOrEqual(POP_HARD_CAP);
      // Population should never drop to 0 (replacements kick in)
      expect(minPop).toBeGreaterThanOrEqual(POP_MINIMUM);
    });
  });
});
