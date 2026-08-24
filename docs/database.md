# Database design

## DynamoDB — `catalog` table

### Access patterns (defined before implementation — CLAUDE.md §4)

| #   | Pattern                               | Key structure                                                         | Status |
| --- | ------------------------------------- | --------------------------------------------------------------------- | ------ |
| 1   | Get product by id                     | `GetItem` `PK = PRODUCT#<id>`, `SK = PRODUCT#<id>`                    | ✅     |
| 2   | List products by category (paginated) | `Query` GSI1 `GSI1PK = CATEGORY#<category>`, `GSI1SK` = `<name>#<id>` | ✅     |
| 3   | Find product by SKU                   | `Query` GSI2 `GSI2PK = SKU#<sku>` (Limit 1)                           | ✅     |
| 4   | List products by status (paginated)   | `Query` GSI3 `GSI3PK = STATUS#<status>`, `GSI3SK` = `<name>#<id>`     | ✅     |
| 5   | Reserve inventory for a product       | `UpdateItem` `PK/SK` `ConditionExpression: available >= :qty`         | ✅     |

`Scan` is never used on the request path (enforced by ESLint
`no-restricted-syntax`). Listing by category **and** status uses pattern 2 plus
a `status` `FilterExpression` — a category partition is small, so the filter is
cheap.

### Item shape

One item per product (`packages/database/src/dynamo/product-keys.ts`):

```
PRODUCT
  PK      = PRODUCT#<id>          SK     = PRODUCT#<id>
  GSI1PK  = CATEGORY#<category>   GSI1SK = <name-lower>#<id>     (pattern 2)
  GSI2PK  = SKU#<sku-upper>                                     (pattern 3)
  GSI3PK  = STATUS#<status>       GSI3SK = <name-lower>#<id>     (pattern 4)
  attributes: id, sku, name, description, category, status,
              priceAmount, priceCurrency, available, reserved,
              imageKeys[], version, createdAt, updatedAt
```

`version` is bumped on every write. `create` uses
`ConditionExpression: attribute_not_exists(PK)`; `update` uses
`attribute_exists(PK) AND version = :expected` (optimistic concurrency).
Inventory mutations (`reserveInventory` / `releaseInventory` / `adjustAvailable`)
are single `UpdateItem` calls with a guard condition and never touch
name/category/status, so the derived GSI sort keys stay valid without a rewrite.

## DynamoDB — `idempotency` table

| Attribute     | Notes                                                |
| ------------- | ---------------------------------------------------- |
| `PK`          | `IDEMPOTENCY#<key>`                                  |
| `status`      | `in_progress` \| `completed`                         |
| `requestHash` | FNV-1a hash of the canonical request body            |
| `response`    | stored HTTP response for replay                      |
| `expiresAt`   | epoch seconds; DynamoDB TTL attribute (24 h default) |

See ADR 004.

## PostgreSQL — orders (Phase 3) ✅

Tables: `customers` → `orders` → `order_items` / `payments` / `shipments`.
All foreign keys are `ON DELETE RESTRICT`; money is stored as `BIGINT` minor
units with `CHECK (>= 0)`; status columns have `CHECK` constraints.

### Every index and the exact query it serves (CLAUDE.md §5)

| Index                                          | Serves                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `customers_email_key` (unique, `lower(email)`) | register / look up a customer by email                                  |
| `customers_auth_subject_key` (unique, partial) | resolve the customer for an authenticated request                       |
| `orders_customer_id_created_at_idx`            | "list a customer's orders, newest first" (`GET /customers/{id}/orders`) |
| `orders_idempotency_key_key` (unique, partial) | one order per `Idempotency-Key` (ADR 004)                               |
| `orders_status_created_at_idx`                 | ops queue view "all orders in status X"                                 |
| `order_items_order_id_idx`                     | load an order's line items (FK join, `GET /orders/{id}`)                |
| `order_items_product_id_idx`                   | "which orders contain product X" (recall tooling)                       |
| `payments_order_id_idx`                        | load payments for an order                                              |
| `payments_provider_ref_key` (unique, partial)  | payment-provider webhook reconciliation                                 |
| `shipments_order_id_idx`                       | load shipments for an order                                             |
| `shipments_tracking_number_idx` (partial)      | carrier webhook lookup by tracking number                               |

### Transactionality

`PostgresOrderRepository.create` writes the order, its items, the initial
payment, and the initial shipment inside a single `BEGIN`/`COMMIT`
(`withTransaction`). A crash mid-write rolls the whole thing back — a partial
order is never observable.

Migrations live in `packages/database/src/postgres/migrations/` (SQL, run with
`node-pg-migrate`) — `pnpm --filter @cloud-commerce/database migrate:up`
(`DATABASE_URL` must be set). They are forward-only in production.
