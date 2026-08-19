# ADR 002 — PostgreSQL / RDS for orders

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Platform team

## Context

Orders are transactional records with real relationships: a customer has many
orders; an order has many line items, one-or-more payments, and one-or-more
shipments. Creating an order must atomically write the order and its items.
Operations staff need ad-hoc queries ("all unfulfilled orders for customer X in
the last 30 days", "revenue by day") that are not known in advance. Referential
integrity matters — an `order_item` must never point at a non-existent order.

## Decision

Store customers, orders, order_items, payments, and shipments in PostgreSQL on
RDS. Use:

- Foreign keys with `ON DELETE RESTRICT` between all five tables.
- SQL transactions for order creation (order + items in one commit).
- Schema migrations (`node-pg-migrate`) from Phase 3 onward — no manual DDL.
- Every non-PK index justified by a named query in `docs/database.md`.
- Credentials from Secrets Manager, never in env or code; SQL always
  parameterised.

## Trade-offs considered

- **DynamoDB for orders too.** Would need careful single-table modelling of a
  genuinely relational aggregate, client-side joins for operational queries, and
  transactions limited to 100 items / 4 MB. The write amplification and query
  rigidity are not worth it for a medium-volume, relationship-heavy workload.
- **Aurora Serverless v2.** Attractive for scale-to-zero in dev. Deferred as a
  cost/ops optimisation; the schema and access code are identical, so switching
  later is a config change.
- **One RDS instance for all environments.** Acceptable initially (documented in
  README); production gets Multi-AZ and its own instance via env config.

## Consequences

- The order write path depends on RDS availability and connection-pool health;
  Lambda uses a small pool (`DATABASE_MAX_POOL`) and RDS Proxy is a documented
  future step for connection storms.
- Reporting queries run against the same instance as transactional writes until
  a read replica / analytics export is added (Future Improvements).
- Migrations are part of the deploy pipeline and must be backward-compatible for
  zero-downtime deploys.
