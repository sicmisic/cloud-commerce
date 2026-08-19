import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation context threaded through every layer of a single logical request
 * (CLAUDE.md §7). Populated at the handler boundary and read implicitly by the
 * logger and by downstream clients (DynamoDB / Postgres / EventBridge / SQS).
 */
export interface RequestContext {
  /** Stable id for the whole request chain, propagated across service hops. */
  readonly correlationId: string;
  /** Id unique to this Lambda invocation (AWS request id when available). */
  readonly requestId: string;
  /** Authenticated subject, once the JWT middleware has run. */
  userId?: string;
  /** Cognito group / role, once known. */
  role?: string;
  /** `METHOD /route` for log grouping. */
  route?: string;
  /** Free-form extra bindings merged into every log line. */
  readonly extra?: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const CORRELATION_HEADER = 'x-correlation-id';

/** Run `fn` with `ctx` available to `getContext()` for its entire async tree. */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Mutate the current context in place (e.g. after auth resolves a userId).
 * No-op when called outside a context scope.
 */
export function patchContext(
  patch: Partial<Pick<RequestContext, 'userId' | 'role' | 'route'>>,
): void {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, patch);
}

/**
 * Build a fresh context, honouring an inbound correlation id header when the
 * caller supplied one so a trace survives across service boundaries.
 */
export function createRequestContext(input?: {
  headers?: Record<string, string | undefined> | null;
  requestId?: string;
  route?: string;
}): RequestContext {
  const headerId = pickHeader(input?.headers, CORRELATION_HEADER);
  return {
    correlationId: headerId ?? randomUUID(),
    requestId: input?.requestId ?? randomUUID(),
    route: input?.route,
  };
}

function pickHeader(
  headers: Record<string, string | undefined> | null | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && value) return value;
  }
  return undefined;
}
