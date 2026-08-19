# ADR 004 — Idempotency keys

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Platform team

## Context

Two retry problems exist in the system:

1. **Client retries.** A mobile client times out on `POST /orders` and retries.
   Without protection this creates two orders and two charges.
2. **At-least-once delivery.** SQS can deliver the same message twice; a worker
   that charges a card on every delivery double-charges.

## Decision

**HTTP layer.** Every mutating endpoint that could plausibly be retried
(`POST /orders` first) requires an `Idempotency-Key` header. The API stores, in
the DynamoDB `idempotency` table under `PK = IDEMPOTENCY#<key>`:

```
{ status: 'in_progress' | 'completed', requestHash, response, expiresAt }
```

- First request: conditionally put `in_progress` (fails if key exists), do the
  work, update to `completed` with the response.
- Retry while in progress: return `409` (client should back off).
- Retry after completion with the **same** `requestHash`: replay the stored
  response, do no work.
- Retry with a **different** `requestHash`: `409 IDEMPOTENCY_MISMATCH` — the key
  was reused for a different request.
- `expiresAt` TTL (24 h default) lets DynamoDB garbage-collect records.

**Worker layer.** Each worker derives a deterministic idempotency key from the
event (`<eventName>#<subject>`) and records processed keys in the same table
(or delegates to the external provider's own idempotency, e.g. the payment
provider's `idempotencyKey`). A duplicate delivery is detected and acked
without repeating the side effect.

**Inventory.** Reservation uses a DynamoDB conditional update
(`available >= :qty`) so two concurrent reservations for the last unit cannot
both succeed — the loser gets `INSUFFICIENT_INVENTORY`, not a negative balance.

## Trade-offs considered

- **Natural idempotency only** (e.g. dedupe on client-supplied order id).
  Fragile — relies on every client generating a good id and on every write path
  checking it. A dedicated key + store is explicit and uniform.
- **Redis/ElastiCache for the idempotency store.** Lower latency, but adds a
  stateful component and its own HA story. DynamoDB with a conditional put is
  fast enough, already in the stack, and gives us TTL for free.
- **SQS FIFO with content-based dedupe.** Only a 5-minute dedupe window and
  doesn't help with HTTP client retries. Used where ordering matters, not as
  the idempotency mechanism.

## Consequences

- Clients are required to send an `Idempotency-Key` on retryable mutations; the
  API rejects those requests without one (documented in `docs/api.md`).
- Every worker must be written to be idempotent; this is a review checklist item.
- The idempotency table is on the critical path for order creation — its
  availability is part of the order write's availability.
