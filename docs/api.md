# API

Base URL (per environment) is the API Gateway HTTP API endpoint, output as
`CloudCommerce-Api-<env>-Url` by CDK.

The machine-readable contract is `docs/openapi.yaml` _(finalised in Phase 7)_.

## Conventions

- **Content type:** `application/json`. Errors are `application/problem+json`
  (RFC 7807-style): `{ type, title, status, detail?, correlationId, ... }`.
- **Correlation:** send `x-correlation-id` to thread a trace; it is echoed on
  the response and appears on every log line.
- **Auth:** `Authorization: Bearer <Cognito ID token>`. Roles: `CUSTOMER`,
  `OPERATIONS`, `ADMIN` (Phase 5).
- **Idempotency:** retryable mutations require `Idempotency-Key: <opaque>`
  (Phase 4, ADR 004).
- **Pagination:** `?limit=` (1–100, default 20) and `?cursor=` (opaque). The
  response includes `nextCursor` when more results exist.

## Endpoints

### Phase 1 — health

| Method | Path            | Auth | Description                                                 |
| ------ | --------------- | ---- | ----------------------------------------------------------- |
| `GET`  | `/health`       | none | Liveness. `{ status: "ok", version, stage, uptimeSeconds }` |
| `GET`  | `/health/ready` | none | Readiness — which downstreams are configured                |
| `GET`  | `/`             | none | Alias for `/health`                                         |

### Phase 2 — catalog ✅

| Method   | Path                              | Auth            | Description                                                            |
| -------- | --------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `GET`    | `/products`                       | none            | List/filter products (`?category=`, `?status=`, `?limit=`, `?cursor=`) |
| `GET`    | `/products/{id}`                  | none            | Get one product                                                        |
| `GET`    | `/products/by-sku/{sku}`          | none            | Look up by SKU                                                         |
| `POST`   | `/products`                       | `catalog:write` | Create a product                                                       |
| `PATCH`  | `/products/{id}`                  | `catalog:write` | Update a product (name/description/category/price/status/images)       |
| `DELETE` | `/products/{id}`                  | `catalog:write` | Archive a product (rejected if it has active reservations)             |
| `POST`   | `/products/{id}/inventory/adjust` | `catalog:write` | Restock / correct on-hand stock (`{ delta, reason? }`)                 |

`POST /products` returns `409 conflict` on a duplicate SKU. Stock adjustment
below zero returns `409 insufficient-inventory`. A product list response is
`{ items: [...], nextCursor: string | null }`.

### Phase 3 — customers & orders ✅

| Method | Path                     | Auth                                | Description                                                                                        |
| ------ | ------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST` | `/customers`             | authenticated                       | Register a customer profile (idempotent by email; linked to the caller's auth subject)             |
| `GET`  | `/customers/me`          | authenticated                       | The caller's customer profile, or `{ registered: false }`                                          |
| `POST` | `/orders`                | `order:create`                      | Create an order — **requires `Idempotency-Key`**; prices are resolved server-side from the catalog |
| `GET`  | `/orders/{id}`           | `order:read:own` / `order:read:any` | Get an order with items, payments, shipments                                                       |
| `GET`  | `/customers/{id}/orders` | own / `order:read:any`              | List a customer's orders, newest first (paginated)                                                 |
| `POST` | `/orders/{id}/cancel`    | `order:cancel:any`                  | Cancel + release reserved inventory (`202`)                                                        |

Order creation: validate → resolve prices from the catalog → **reserve
inventory** (conditional writes; compensating release on any later failure) →
persist order+items+payment+shipment in one Postgres transaction → publish
`OrderCreated` + `PaymentRequested`. Out-of-stock returns
`409 insufficient-inventory`; an unregistered caller returns `409`.

### Phase 4 — admin (dead-letter queues) ✅

| Method | Path                                        | Auth                        | Description                                                                     |
| ------ | ------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/admin/failed-events`                      | `admin:failed-events:read`  | Depth + a non-destructive sample of each DLQ (payment/email/shipping/inventory) |
| `POST` | `/admin/failed-events/{queue}/retry`        | `admin:failed-events:retry` | Start an SQS message-move task re-driving that DLQ to its source queue (`202`)  |
| `GET`  | `/admin/failed-events/{queue}/retry-status` | `admin:failed-events:read`  | Status of recent redrive tasks for that DLQ                                     |

`{queue}` is one of `payment`, `email`, `shipping`, `inventory`.
