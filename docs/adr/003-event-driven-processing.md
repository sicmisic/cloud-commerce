# ADR 003 — EventBridge + SQS for order processing

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Platform team

## Context

Placing an order triggers several independent side effects: reserve inventory,
charge payment, send a confirmation email, request a shipment. These have
different latencies, failure modes, and retry semantics. The HTTP request that
creates the order must not block on any of them, and a failure in email must not
roll back a successful payment.

## Decision

Producers publish domain events (`OrderCreated`, `PaymentCompleted`, …) to a
single EventBridge bus. EventBridge rules route each event to one or more SQS
queues. Each queue backs one worker Lambda (payment, email, shipping,
inventory). Every queue has:

- a visibility timeout ≥ 6× the worker's timeout,
- `maxReceiveCount` (bounded retries) then a dead-letter queue,
- a CloudWatch alarm on DLQ depth.

Workers are idempotent (ADR 004) because SQS is at-least-once.

**EventBridge for fan-out, SQS for the work queue** — EventBridge decouples
producers from the set of consumers (add a consumer = add a rule, no producer
change); SQS gives each consumer independent durability, retry, and back-pressure.

## Trade-offs considered

- **SNS instead of EventBridge.** SNS fans out fine but has weaker filtering,
  no schema registry, no archive/replay. EventBridge's content-based rules and
  event archive (for replay after a bug fix) are worth the slightly higher
  latency.
- **Direct Lambda invokes from the order service.** Tightest coupling, no
  buffering, retries become the producer's problem, and a slow downstream
  becomes a slow checkout. Rejected.
- **Step Functions for the whole flow.** A good fit for a strict saga with
  compensation. Deferred: the current flow is fan-out with independent retry,
  not a linear orchestration, and Step Functions would centralise logic we want
  in autonomous workers. Revisit if we need cross-worker compensation.
- **One queue for all workers.** Couples unrelated failure domains and makes
  per-worker back-pressure impossible.

## Consequences

- The system is eventually consistent: an order is `CONFIRMED` only after the
  payment worker succeeds and emits `PaymentCompleted`. The API and UI must
  represent "processing" states.
- Operational tooling is required for the DLQs — `GET /admin/failed-events` and
  `POST /admin/failed-events/{id}/retry` are in scope, not "future work".
- Every event payload is versioned; consumers tolerate unknown fields.
