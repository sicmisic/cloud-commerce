/**
 * Domain error taxonomy. Handlers map these to HTTP status codes in one place
 * (apps/api/src/middleware/error-handler.ts) — business code throws semantic
 * errors and never imports HTTP concepts.
 */

export type DomainErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_INVENTORY'
  | 'PAYMENT_DECLINED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_MISMATCH'
  | 'DEPENDENCY_FAILURE';

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  /** True when a retry with identical input could succeed. */
  readonly retryable: boolean = false;
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION' as const;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND' as const;
  constructor(entity: string, id: string) {
    super(`${entity} '${id}' was not found`, { entity, id });
  }
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT' as const;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class InsufficientInventoryError extends DomainError {
  readonly code = 'INSUFFICIENT_INVENTORY' as const;
  constructor(productId: string, requested: number, available: number) {
    super(`Insufficient inventory for product '${productId}'`, {
      productId,
      requested,
      available,
    });
  }
}

export class PaymentDeclinedError extends DomainError {
  readonly code = 'PAYMENT_DECLINED' as const;
  constructor(reason: string, details?: Record<string, unknown>) {
    super(`Payment declined: ${reason}`, details);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED' as const;
  constructor(message = 'Authentication required') {
    super(message);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN' as const;
  constructor(message = 'Insufficient permissions for this action') {
    super(message);
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_MISMATCH' as const;
  constructor(key: string) {
    super(`Idempotency-Key '${key}' was reused with a different request body`, { key });
  }
}

/** Wraps a failure in an external dependency (DB, queue, provider). Retryable. */
export class DependencyFailureError extends DomainError {
  readonly code = 'DEPENDENCY_FAILURE' as const;
  override readonly retryable = true;
  constructor(dependency: string, cause?: unknown) {
    super(`Dependency '${dependency}' failed`, {
      dependency,
      cause: cause instanceof Error ? cause.message : String(cause ?? 'unknown'),
    });
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
