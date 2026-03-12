import type { Tier } from '../shared/types';

interface RateBucket {
  count: number;
  resetAt: number;
}

// In-memory rate limiting (resets on cold start, which is fine for Workers)
const secondBuckets = new Map<Tier, RateBucket>();
const minuteBuckets = new Map<Tier, RateBucket>();
const hourBuckets = new Map<Tier, RateBucket>();

const LIMITS: Record<Tier, { perSecond: number; secondWindow: number; perMinute: number; perHour: number }> = {
  simple:  { perSecond: 2, secondWindow: 1_000,  perMinute: 10, perHour: 300 },
  medium:  { perSecond: 1, secondWindow: 1_000,  perMinute: 4,  perHour: 100 },
  complex: { perSecond: 1, secondWindow: 5_000,  perMinute: 1,  perHour: 30 },
  premium: { perSecond: 1, secondWindow: 10_000, perMinute: 1,  perHour: 6 },
};

function checkBucket(
  buckets: Map<Tier, RateBucket>,
  tier: Tier,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  let bucket = buckets.get(tier);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(tier, bucket);
  }

  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** Reset all buckets (for testing) */
export function _resetBuckets(): void {
  secondBuckets.clear();
  minuteBuckets.clear();
  hourBuckets.clear();
}

export function checkRateLimit(tier: Tier): boolean {
  const limits = LIMITS[tier];
  const secondOk = checkBucket(secondBuckets, tier, limits.perSecond, limits.secondWindow);
  if (!secondOk) return false;
  const minuteOk = checkBucket(minuteBuckets, tier, limits.perMinute, 60_000);
  if (!minuteOk) return false;
  const hourOk = checkBucket(hourBuckets, tier, limits.perHour, 3_600_000);
  return hourOk;
}
