import { getConfig } from '@cloud-commerce/config';

import { type Middleware } from '../http/types';

/**
 * Explicit CORS handling (CLAUDE.md §8 — CORS is not assumed). Echoes the
 * request origin only when it is on the configured allow-list; `*` allows any.
 */
export const withCors: Middleware = (next) => async (req) => {
  const { corsAllowedOrigins } = getConfig().http;
  const origin = req.headers['origin'];
  const allowOrigin = corsAllowedOrigins.includes('*')
    ? '*'
    : origin && corsAllowedOrigins.includes(origin)
      ? origin
      : undefined;

  const corsHeaders: Record<string, string> = allowOrigin
    ? {
        'access-control-allow-origin': allowOrigin,
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers':
          'content-type,authorization,idempotency-key,x-correlation-id',
        'access-control-max-age': '600',
        vary: 'origin',
      }
    : {};

  if (req.method.toUpperCase() === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const res = await next(req);
  res.headers = { ...corsHeaders, ...res.headers };
  return res;
};
