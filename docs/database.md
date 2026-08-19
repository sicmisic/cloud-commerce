# Database design

## DynamoDB — `catalog` table

### Access patterns (defined before implementation — CLAUDE.md §4)

| #   | Pattern                               | Key structure                                                      | Phase |
| --- | ------------------------------------- | ------------------------------------------------------------------ | ----- |
| 1   | Get product by id                     | `GetItem` `PK = PRODUCT#<id>`, `SK = PRODUCT#<id>`                 | 2     |
| 2   | List products by category (paginated) | `Query` GSI1 `GSI1PK = CATEGORY#<category>`                        | 2     |
| 3   | Find product by SKU                   | `Query` GSI2 `GSI2PK = SKU#<sku>` (limit 1)                        | 2     |
| 4   | List active products (paginated)      | `Query` GSI1 `GSI1PK = STATUS#active`, sort by `GSI1SK = <name>`   | 2     |
| 5   | Reserve inventory for a product       | `UpdateItem` `PK/SK` with `ConditionExpression: available >= :qty` | 2     |

`Scan` is never used on the request path (enforced by ESLint
`no-restricted-syntax`).

### Item shapes _(Phase 2)_

```
PRODUCT
  PK      = PRODUCT#<id>
  SK      = PRODUCT#<id>
  GSI1PK  = CATEGORY#<category>
  GSI1SK  = PRODUCT#<name>#<id>
  GSI2PK  = SKU#<sku>
  ... attributes: name, description, priceAmount, priceCurrency, status,
      available, reserved, version, createdAt, updatedAt
```

A second GSI1 partition per product (`STATUS#<status>`) is written as a mirror
item so pattern 4 works without a filter. _(Detailed in Phase 2.)_

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
