-- Up Migration
-- Phase 3 — transactional order data (ADR 002).
-- Referential integrity is enforced with foreign keys; every non-PK index below
-- names the exact query it serves (CLAUDE.md §5).

CREATE TABLE customers (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  auth_subject  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves: register/lookup a customer by email (unique, case-normalised in app).
CREATE UNIQUE INDEX customers_email_key ON customers (lower(email));
-- Serves: resolve the customer for an authenticated request (Phase 5).
CREATE UNIQUE INDEX customers_auth_subject_key ON customers (auth_subject)
  WHERE auth_subject IS NOT NULL;

CREATE TABLE orders (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  status            TEXT NOT NULL
                    CHECK (status IN ('pending','confirmed','processing','fulfilled','cancelled')),
  currency          CHAR(3) NOT NULL,
  subtotal_amount   BIGINT NOT NULL CHECK (subtotal_amount >= 0),
  tax_amount        BIGINT NOT NULL CHECK (tax_amount >= 0),
  shipping_amount   BIGINT NOT NULL CHECK (shipping_amount >= 0),
  total_amount      BIGINT NOT NULL CHECK (total_amount >= 0),
  shipping_address  JSONB NOT NULL,
  billing_address   JSONB NOT NULL,
  idempotency_key   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves: "list a customer's orders, newest first" (GET /customers/{id}/orders).
CREATE INDEX orders_customer_id_created_at_idx ON orders (customer_id, created_at DESC);
-- Serves: idempotent POST /orders — one order per Idempotency-Key (ADR 004).
CREATE UNIQUE INDEX orders_idempotency_key_key ON orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- Serves: ops queue view "all orders in a given status" (Phase 6 dashboards).
CREATE INDEX orders_status_created_at_idx ON orders (status, created_at DESC);

CREATE TABLE order_items (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  product_id   TEXT NOT NULL,
  sku          TEXT NOT NULL,
  name         TEXT NOT NULL,
  unit_price_amount BIGINT NOT NULL CHECK (unit_price_amount >= 0),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  line_total_amount BIGINT NOT NULL CHECK (line_total_amount >= 0)
);

-- Serves: load an order's line items (FK join in GET /orders/{id}).
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
-- Serves: "which orders contain product X" (ops / recall tooling).
CREATE INDEX order_items_product_id_idx ON order_items (product_id);

CREATE TABLE payments (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  status         TEXT NOT NULL
                 CHECK (status IN ('pending','captured','failed','refunded')),
  amount_amount  BIGINT NOT NULL CHECK (amount_amount >= 0),
  currency       CHAR(3) NOT NULL,
  provider       TEXT NOT NULL,
  provider_ref   TEXT,
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves: load payments for an order (GET /orders/{id}).
CREATE INDEX payments_order_id_idx ON payments (order_id);
-- Serves: payment-provider webhook reconciliation by provider reference.
CREATE UNIQUE INDEX payments_provider_ref_key ON payments (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

CREATE TABLE shipments (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  status           TEXT NOT NULL
                   CHECK (status IN ('requested','dispatched','delivered','failed')),
  address          JSONB NOT NULL,
  carrier          TEXT,
  tracking_number  TEXT,
  provider_ref     TEXT,
  estimated_delivery_date DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves: load shipments for an order (GET /orders/{id}).
CREATE INDEX shipments_order_id_idx ON shipments (order_id);
-- Serves: carrier webhook lookup by tracking number.
CREATE INDEX shipments_tracking_number_idx ON shipments (tracking_number)
  WHERE tracking_number IS NOT NULL;

-- Down Migration
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
