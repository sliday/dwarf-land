import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, _resetBuckets } from '../src/guardrails/rate-limiter';

describe('Rate Limiter', () => {
  beforeEach(() => {
    _resetBuckets();
  });

  describe('per-second limits', () => {
    it('allows SIMPLE tier up to 2 calls per second', () => {
      expect(checkRateLimit('simple')).toBe(true);
      expect(checkRateLimit('simple')).toBe(true);
      expect(checkRateLimit('simple')).toBe(false);
    });

    it('allows MEDIUM tier 1 call per second', () => {
      expect(checkRateLimit('medium')).toBe(true);
      expect(checkRateLimit('medium')).toBe(false);
    });

    it('allows COMPLEX tier 1 call per 5 seconds', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      expect(checkRateLimit('complex')).toBe(true);
      expect(checkRateLimit('complex')).toBe(false);

      // After 3 seconds, still blocked by second window (5s)
      vi.advanceTimersByTime(3000);
      expect(checkRateLimit('complex')).toBe(false);

      // After 5+ seconds, second window resets but minute bucket (1/min) is exhausted
      vi.advanceTimersByTime(2100);
      expect(checkRateLimit('complex')).toBe(false); // minute limit hit

      // After full minute reset
      vi.advanceTimersByTime(55000);
      expect(checkRateLimit('complex')).toBe(true);

      vi.useRealTimers();
    });

    it('allows PREMIUM tier 1 call per 10 seconds', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      expect(checkRateLimit('premium')).toBe(true);
      expect(checkRateLimit('premium')).toBe(false);

      vi.advanceTimersByTime(9000);
      expect(checkRateLimit('premium')).toBe(false);

      // After 10+ seconds second window resets, but minute limit (1) already used
      vi.advanceTimersByTime(1100);
      expect(checkRateLimit('premium')).toBe(false);

      // After minute resets
      vi.advanceTimersByTime(50000);
      expect(checkRateLimit('premium')).toBe(true);

      vi.useRealTimers();
    });

    it('resets second bucket after window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      // Exhaust second limit for simple
      checkRateLimit('simple');
      checkRateLimit('simple');
      expect(checkRateLimit('simple')).toBe(false);

      // Advance 1.1 seconds
      vi.advanceTimersByTime(1100);
      expect(checkRateLimit('simple')).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('per-minute limits', () => {
    it('allows SIMPLE tier up to 10 calls per minute', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      let allowed = 0;
      for (let sec = 0; sec < 30; sec++) {
        vi.advanceTimersByTime(1100); // advance past second window
        if (checkRateLimit('simple')) allowed++;
        if (checkRateLimit('simple')) allowed++;
      }
      // per-minute cap = 10 should cap before 60 calls
      expect(allowed).toBe(10);

      vi.useRealTimers();
    });

    it('allows MEDIUM tier up to 4 calls per minute', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      let allowed = 0;
      for (let sec = 0; sec < 10; sec++) {
        vi.advanceTimersByTime(1100);
        if (checkRateLimit('medium')) allowed++;
      }
      expect(allowed).toBe(4);

      vi.useRealTimers();
    });

    it('allows COMPLEX tier at most 1 call per 5 sec window within minute', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      let allowed = 0;
      // Try every 6 seconds for a full minute
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(6000);
        if (checkRateLimit('complex')) allowed++;
      }
      // minute cap = 1, so only 1 should get through per minute
      expect(allowed).toBeLessThanOrEqual(2); // could be 2 if minute window resets

      vi.useRealTimers();
    });

    it('allows PREMIUM tier at most 1 call per 10 sec window within minute', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      expect(checkRateLimit('premium')).toBe(true);
      vi.advanceTimersByTime(11000);
      // Second window reset, but minute cap = 1
      expect(checkRateLimit('premium')).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('per-hour limits', () => {
    it('allows SIMPLE tier up to 300 calls per hour', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      let allowed = 0;
      // Need to respect per-second (2/s) and per-minute (10/min) limits
      // 10 per minute * 30 minutes = 300 to exhaust hour bucket
      for (let minute = 0; minute < 35; minute++) {
        vi.advanceTimersByTime(61000); // advance past minute window
        for (let sec = 0; sec < 30; sec++) {
          vi.advanceTimersByTime(1100); // advance past second window
          for (let i = 0; i < 2; i++) {
            if (checkRateLimit('simple')) allowed++;
          }
        }
      }
      // Should have been capped at 300 by hour bucket
      expect(allowed).toBeLessThanOrEqual(300);
      expect(allowed).toBe(300);

      vi.useRealTimers();
    });

    it('allows PREMIUM tier up to 6 calls per hour', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      let allowed = 0;
      for (let minute = 0; minute < 10; minute++) {
        vi.advanceTimersByTime(61000);
        if (checkRateLimit('premium')) allowed++;
      }
      expect(allowed).toBe(6);

      vi.useRealTimers();
    });
  });

  describe('bucket reset', () => {
    it('resets minute bucket after window expires', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      // Exhaust minute limit
      for (let i = 0; i < 10; i++) checkRateLimit('simple');
      expect(checkRateLimit('simple')).toBe(false);

      // Advance 61 seconds
      vi.advanceTimersByTime(61000);
      expect(checkRateLimit('simple')).toBe(true);

      vi.useRealTimers();
    });

    it('resets hour bucket after window expires', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));

      // Use all hour calls for premium (6)
      for (let i = 0; i < 6; i++) {
        checkRateLimit('premium');
        vi.advanceTimersByTime(61000); // advance past minute window
      }
      // Minute bucket reset but hour should be exhausted
      vi.advanceTimersByTime(61000);
      expect(checkRateLimit('premium')).toBe(false);

      // Advance past hour window
      vi.advanceTimersByTime(3600000);
      expect(checkRateLimit('premium')).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('tier isolation', () => {
    it('exhausting one tier does not affect others', () => {
      // Exhaust simple
      for (let i = 0; i < 10; i++) checkRateLimit('simple');
      expect(checkRateLimit('simple')).toBe(false);

      // Other tiers still work
      expect(checkRateLimit('medium')).toBe(true);
      expect(checkRateLimit('complex')).toBe(true);
      expect(checkRateLimit('premium')).toBe(true);
    });
  });
});
