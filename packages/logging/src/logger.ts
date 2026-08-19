import { getConfig } from '@cloud-commerce/config';
import pino, { type Logger, type LoggerOptions } from 'pino';

import { getContext } from './context';

/**
 * Structured JSON logging only — never `console.log` free text (CLAUDE.md §7).
 * One root logger per process; per-request data is merged via a `mixin` that
 * reads the AsyncLocalStorage correlation context, so callers never have to
 * pass the correlation id around by hand.
 */

let root: Logger | undefined;

function buildRoot(): Logger {
  const config = safeConfig();
  const options: LoggerOptions = {
    level: config.logLevel,
    base: {
      service: config.serviceName,
      stage: config.stage,
    },
    // Redact anything that could carry a secret or PII token.
    redact: {
      paths: [
        'password',
        '*.password',
        'authorization',
        'headers.authorization',
        'req.headers.authorization',
        '*.secret',
        '*.token',
        'card.number',
        'payment.card',
      ],
      censor: '[redacted]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const ctx = getContext();
      if (!ctx) return {};
      return {
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
        ...(ctx.userId ? { userId: ctx.userId } : {}),
        ...(ctx.role ? { role: ctx.role } : {}),
        ...(ctx.route ? { route: ctx.route } : {}),
        ...(ctx.extra ?? {}),
      };
    },
  };

  // Pretty output locally; raw JSON in Lambda (CloudWatch parses it natively).
  if (process.env.LOG_PRETTY === 'true') {
    options.transport = { target: 'pino-pretty', options: { colorize: true } };
  }

  return pino(options);
}

function safeConfig() {
  try {
    return getConfig();
  } catch {
    return {
      logLevel: (process.env.LOG_LEVEL as LoggerOptions['level']) ?? 'info',
      serviceName: process.env.SERVICE_NAME ?? 'cloud-commerce',
      stage: process.env.STAGE ?? 'dev',
    } as ReturnType<typeof getConfig>;
  }
}

/** The root logger (correlation context auto-injected via mixin). */
export function getLogger(): Logger {
  if (!root) root = buildRoot();
  return root;
}

/** Child logger with static component bindings, e.g. `logger('OrderRepository')`. */
export function logger(component: string, bindings: Record<string, unknown> = {}): Logger {
  return getLogger().child({ component, ...bindings });
}

/** Test helper — force the root logger to rebuild (e.g. after changing env). */
export function resetLogger(): void {
  root = undefined;
}

export type { Logger };
