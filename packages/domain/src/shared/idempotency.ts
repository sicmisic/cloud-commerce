/**
 * Idempotency port (ADR 004). Used by the HTTP layer for retryable mutations
 * (`POST /orders`) and by every SQS worker to dedupe at-least-once delivery.
 * Implemented by `DynamoIdempotencyStore`; tests use `InMemoryIdempotencyStore`.
 */

export type IdempotencyStatus = 'in_progress' | 'completed';

export interface IdempotencyRecord {
  readonly key: string;
  readonly status: IdempotencyStatus;
  readonly requestHash: string;
  readonly response?: unknown;
  readonly createdAt: string;
}

export type ClaimResult =
  | { readonly outcome: 'claimed' }
  | { readonly outcome: 'in_progress'; readonly record: IdempotencyRecord }
  | { readonly outcome: 'completed'; readonly record: IdempotencyRecord }
  | { readonly outcome: 'mismatch'; readonly record: IdempotencyRecord };

export interface IdempotencyStore {
  /**
   * Attempt to claim `key`. `claimed` means the caller should do the work;
   * `completed` means replay `record.response`; `in_progress` means a
   * concurrent attempt is running (caller should 409 / retry later);
   * `mismatch` means the key was reused with a different `requestHash`.
   */
  claim(key: string, requestHash: string, ttlSeconds: number): Promise<ClaimResult>;

  /** Mark the claimed key completed and store the response for replay. */
  complete(key: string, response: unknown): Promise<void>;

  /** Release the claim so a retry can proceed (work failed recoverably). */
  release(key: string): Promise<void>;
}
