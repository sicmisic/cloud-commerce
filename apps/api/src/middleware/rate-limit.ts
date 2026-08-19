import { getConfig } from '@cloud-commerce/config';
import { getLogger } from '@cloud-commerce/logging';

import { problem } from '../http/response';
import { type Middleware } from '../http/types';

/**
 * Best-effort in-process token bucket — defence in depth only. The authoritative
 * rate limit is the API Gateway stage throttle + WAF rate rule configured in the
 * API stack; this catches a hot loop hitting a single warm container.
 */
const buckets = new Map<string, { tokens: number; updatedAt: number }>();

export const withRateLimit: Middleware = (next) => async (req) => {
  const perMinute = getConfig().http.rateLimitPerMinute;
  const key =
    req.principal?.userId ?? req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? 'anonymous';

  const now = Date.now();
  const refillPerMs = perMinute / 60_000;
  const bucket = buckets.get(key) ?? { tokens: perMinute, updatedAt: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    getLogger().warn({ key }, 'rate limit exceeded (in-process guard)');
    return problem({
      type: 'rate-limited',
      title: 'Too many requests',
      status: 429,
      detail: `Limit is ${perMinute} requests/minute.`,
    });
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return next(req);
};

/** Test helper. */
export function resetRateLimiter(): void {
  buckets.clear();
}
