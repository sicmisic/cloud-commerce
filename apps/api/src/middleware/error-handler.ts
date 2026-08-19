import { type DomainErrorCode, isDomainError } from '@cloud-commerce/domain';
import { getContext, getLogger } from '@cloud-commerce/logging';
import { ValidationFailure } from '@cloud-commerce/validation';

import { problem } from '../http/response';
import { type Middleware } from '../http/types';

/**
 * Single place that maps thrown errors to HTTP. Business code throws semantic
 * domain errors; nothing below the handler imports HTTP status codes
 * (CLAUDE.md §3).
 */

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_INVENTORY: 409,
  PAYMENT_DECLINED: 402,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  IDEMPOTENCY_MISMATCH: 409,
  DEPENDENCY_FAILURE: 502,
};

const TYPE_SLUG: Record<DomainErrorCode, string> = {
  VALIDATION: 'validation-error',
  NOT_FOUND: 'not-found',
  CONFLICT: 'conflict',
  INSUFFICIENT_INVENTORY: 'insufficient-inventory',
  PAYMENT_DECLINED: 'payment-declined',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  IDEMPOTENCY_MISMATCH: 'idempotency-conflict',
  DEPENDENCY_FAILURE: 'dependency-failure',
};

export const withErrorHandler: Middleware = (next) => async (req) => {
  try {
    return await next(req);
  } catch (err) {
    const correlationId = getContext()?.correlationId;
    const log = getLogger();

    if (err instanceof ValidationFailure) {
      log.info({ issues: err.issues }, 'request rejected: validation');
      return problem({
        type: 'validation-error',
        title: 'The request payload is invalid',
        status: 422,
        detail: err.message,
        issues: err.issues,
        correlationId,
      });
    }

    if (isDomainError(err)) {
      const status = STATUS_BY_CODE[err.code];
      // 5xx domain errors are real incidents; 4xx are client problems.
      if (status >= 500) log.error({ err }, 'request failed: dependency');
      else log.info({ code: err.code, detail: err.details }, 'request rejected: domain rule');
      return problem({
        type: TYPE_SLUG[err.code],
        title: err.message,
        status,
        detail: err.details ? undefined : err.message,
        correlationId,
        ...(err.details ? { context: err.details } : {}),
        ...(err.retryable ? { retryable: true } : {}),
      });
    }

    log.error({ err }, 'unhandled error');
    return problem({
      type: 'internal-error',
      title: 'An unexpected error occurred',
      status: 500,
      detail: 'The failure has been logged. Quote the correlation id when reporting it.',
      correlationId,
    });
  }
};
