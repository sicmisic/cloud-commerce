import { MetricsCollector, METRIC, getLogger, runWithContext } from '@cloud-commerce/logging';

import { type Middleware } from '../http/types';

/**
 * Outermost middleware. Establishes the AsyncLocalStorage correlation scope for
 * the whole request, logs a structured start/end pair, and emits the
 * `LambdaDuration` / `LambdaErrors` metrics (CLAUDE.md §7).
 *
 * `req.context` is populated by the Lambda adapter (or by a test) before this
 * runs.
 */
export const withRequestContext: Middleware = (next) => async (req) => {
  return runWithContext(req.context, async () => {
    const log = getLogger();
    const metrics = new MetricsCollector({ Route: req.context.route ?? 'unmatched' });
    const startedAt = performance.now();

    log.info({ method: req.method, path: req.path }, 'request received');

    try {
      const res = await next(req);
      const durationMs = Math.round(performance.now() - startedAt);
      metrics.duration(METRIC.LambdaDuration, durationMs);
      if (res.statusCode >= 500) metrics.count(METRIC.LambdaErrors);
      log.info({ statusCode: res.statusCode, durationMs }, 'request completed');
      res.headers['x-correlation-id'] = req.context.correlationId;
      return res;
    } catch (err) {
      metrics.count(METRIC.LambdaErrors);
      metrics.duration(METRIC.LambdaDuration, Math.round(performance.now() - startedAt));
      log.error({ err }, 'request failed with an unhandled error');
      throw err;
    } finally {
      metrics.flush();
    }
  });
};
