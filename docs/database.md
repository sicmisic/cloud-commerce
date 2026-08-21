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

## PostgreSQL _(Phase 3)_

Tables: `customers`, `orders`, `order_items`, `payments`, `shipments`.

Every index will be listed here with the exact query it serves (CLAUDE.md §5),
e.g.:

| Index                               | Serves                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `orders_customer_id_created_at_idx` | "list a customer's orders, newest first" (`GET /customers/{id}/orders`) |
| `order_items_order_id_idx`          | load line items for an order (FK + join)                                |
| `payments_order_id_idx`             | load payments for an order                                              |
| `shipments_tracking_number_idx`     | carrier webhook lookup by tracking number                               |

Migrations live in `packages/database/migrations/` and run via
`pnpm --filter @cloud-commerce/database migrate:up`.
