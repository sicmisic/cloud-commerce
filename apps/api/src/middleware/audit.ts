import { getLogger } from '@cloud-commerce/logging';

import { type Middleware } from '../http/types';

/**
 * Audit log for state-changing requests (CLAUDE.md §8 — audit logging is
 * explicit, not assumed). Emits one structured `audit` line per mutation with
 * the actor, action, target, and outcome. Reads are not audited (too noisy and
 * low value); `/health*` is always skipped.
 *
 * Sits just inside the error handler so it observes the final status code, and
 * inside auth so `req.principal` is populated.
 */
const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const withAudit: Middleware = (next) => async (req) => {
  const method = req.method.toUpperCase();
  const shouldAudit = AUDITED_METHODS.has(method) && !req.path.startsWith('/health');

  if (!shouldAudit) return next(req);

  const actor = req.principal
    ? { userId: req.principal.userId, roles: req.principal.roles }
    : { userId: 'anonymous', roles: [] as string[] };
  const action = `${method} ${req.context.route ?? req.path}`;

  try {
    const res = await next(req);
    getLogger().info(
      {
        audit: true,
        actor,
        action,
        params: req.params,
        statusCode: res.statusCode,
        outcome: res.statusCode < 400 ? 'success' : 'rejected',
      },
      'audit',
    );
    return res;
  } catch (err) {
    getLogger().warn(
      { audit: true, actor, action, params: req.params, outcome: 'error', err },
      'audit',
    );
    throw err;
  }
};
