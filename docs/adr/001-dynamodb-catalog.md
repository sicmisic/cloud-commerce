# ADR 001 — DynamoDB for the product catalog

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Platform team

## Context

The catalog is the highest-traffic read surface in the system: every storefront
page view, search, and add-to-cart hits it. Access is almost always by a known
key (product id, SKU) or a small set of known list queries (by category, by
status). Writes are comparatively rare (merchandisers editing products, workers
decrementing inventory). We need predictable single-digit-millisecond reads at
arbitrary scale, and we do not need ad-hoc querying or multi-row transactions
across products.

## Decision

Store the product catalog and inventory counters in a single DynamoDB table
(`catalog`), designed around four documented access patterns (see
`docs/database.md`):

1. Get product by id
2. List products by category (paginated)
3. Find product by SKU
4. List active products (paginated)

Keys: `PK = PRODUCT#<id>`, `SK = PRODUCT#<id>` for the item row; `GSI1` keyed on
`CATEGORY#<category>` / `STATUS#<status>#<name>` for patterns 2 and 4; `GSI2`
keyed on `SKU#<sku>` for pattern 3. Inventory is an attribute on the product
item, mutated with a conditional update (`available >= :qty`) for optimistic
concurrency (see ADR 004 and `docs/database.md`).

`Scan` is banned on the request path and enforced by an ESLint rule.

## Trade-offs considered

- **PostgreSQL for everything.** Simpler mental model, one datastore. Rejected:
  the catalog read pattern is a key-value pattern at heart, and putting the
  hottest reads on the same RDS instance that serves transactional order writes
  couples two very different load profiles and failure domains.
- **DynamoDB + OpenSearch for search.** Needed eventually for full-text search
  and faceting. Deferred — the four access patterns above are satisfied by
  DynamoDB alone, and adding OpenSearch now is scope we cannot justify.
- **Single-table vs table-per-entity.** Single table for catalog + inventory
  because they are updated together; idempotency records get their own table
  because their lifecycle (TTL-expiring) and access pattern are unrelated.

## Consequences

- New catalog query patterns require a new GSI or a data-model change, not just
  a new `WHERE` clause. This is a deliberate forcing function: access patterns
  are designed up front (CLAUDE.md §4).
- Cross-entity reporting ("top categories by revenue") cannot come from this
  table; it comes from the orders database or an analytics export.
- Inventory correctness depends on conditional writes, covered by ADR 004.
