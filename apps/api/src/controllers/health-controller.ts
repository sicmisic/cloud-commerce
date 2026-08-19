import { getConfig } from '@cloud-commerce/config';

import { ok } from '../http/response';
import { type HttpRequest } from '../http/types';

const BOOTED_AT = Date.now();
const VERSION = process.env.APP_VERSION ?? '0.1.0';

/**
 * Thin controller — no business logic, just shapes the response (CLAUDE.md §3).
 * `/health` is deliberately dependency-free so it stays green during a partial
 * outage; deep checks live at `/health/ready`.
 */
export class HealthController {
  live(_req: HttpRequest) {
    return ok({
      status: 'ok',
      version: VERSION,
      stage: getConfig().stage,
      uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
      time: new Date().toISOString(),
    });
  }

  ready(req: HttpRequest) {
    const config = getConfig();
    // Report which downstreams are configured. Phase 6 adds active probes.
    const checks = {
      catalogTable: Boolean(config.dynamodb.catalogTableName),
      idempotencyTable: Boolean(config.dynamodb.idempotencyTableName),
      database: Boolean(config.postgres.secretArn || config.postgres.url),
      eventBus: Boolean(config.messaging.eventBusName),
    };
    const ready = Object.values(checks).every(Boolean);
    return ok({
      status: ready ? 'ready' : 'degraded',
      checks,
      correlationId: req.context.correlationId,
    });
  }
}
