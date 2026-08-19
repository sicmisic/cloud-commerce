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

### Phase 2 — catalog _(planned)_

| Method   | Path                     | Auth       | Description                                                 |
| -------- | ------------------------ | ---------- | ----------------------------------------------------------- |
| `GET`    | `/products`              | none       | List/filter products (`?category=`, `?status=`, pagination) |
| `GET`    | `/products/{id}`         | none       | Get one product                                             |
| `GET`    | `/products/by-sku/{sku}` | none       | Look up by SKU                                              |
| `POST`   | `/products`              | OPERATIONS | Create a product                                            |
| `PATCH`  | `/products/{id}`         | OPERATIONS | Update a product                                            |
| `DELETE` | `/products/{id}`         | OPERATIONS | Archive a product                                           |

### Phase 3 — orders _(planned)_

| Method | Path                     | Auth                        | Description                                  |
| ------ | ------------------------ | --------------------------- | -------------------------------------------- |
| `POST` | `/orders`                | CUSTOMER                    | Create an order (requires `Idempotency-Key`) |
| `GET`  | `/orders/{id}`           | CUSTOMER (own) / OPERATIONS | Get an order                                 |
| `GET`  | `/customers/{id}/orders` | CUSTOMER (own) / OPERATIONS | List a customer's orders                     |
| `POST` | `/orders/{id}/cancel`    | OPERATIONS                  | Cancel + release inventory                   |

### Phase 4 — admin _(planned)_

| Method | Path                              | Auth       | Description            |
| ------ | --------------------------------- | ---------- | ---------------------- |
| `GET`  | `/admin/failed-events`            | OPERATIONS | List DLQ messages      |
| `POST` | `/admin/failed-events/{id}/retry` | OPERATIONS | Re-drive a DLQ message |
