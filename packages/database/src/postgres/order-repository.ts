import {
  ConflictError,
  DependencyFailureError,
  type Money,
  type Order,
  type OrderStatus,
  type OrderRepository,
  type OrderSummary,
  type OrderView,
  type NewOrderRecord,
  type Page,
  type PageRequest,
  type Payment,
  type Shipment,
  decodeCursor,
  encodeCursor,
  normalizeLimit,
} from '@cloud-commerce/domain';

import { isUniqueViolation } from './customer-repository';
import { getPool, withTransaction } from './pool';
import { type Queryable } from './types';

/**
 * PostgreSQL implementation of {@link OrderRepository}. `create` writes the
 * order, items, payment, and shipment inside one transaction so a partial order
 * can never be observed (ADR 002).
 */
export class PostgresOrderRepository implements OrderRepository {
  async create(record: NewOrderRecord): Promise<void> {
    try {
      await withTransaction(async (tx) => {
        await insertOrder(tx, record.order);
        for (const item of record.order.items) {
          await tx.query(
            `INSERT INTO order_items
               (id, order_id, product_id, sku, name, unit_price_amount, quantity, line_total_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              item.id,
              record.order.id,
              item.productId,
              item.sku,
              item.name,
              item.unitPrice.amount,
              item.quantity,
              item.lineTotal.amount,
            ],
          );
        }
        await insertPayment(tx, record.payment, record.order.currency);
        await insertShipment(tx, record.shipment);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('order already exists (id or idempotency key clash)', {
          orderId: record.order.id,
        });
      }
      throw new DependencyFailureError('postgres', err);
    }
  }

  async findById(id: string): Promise<OrderView | null> {
    return this.load('SELECT * FROM orders WHERE id = $1', [id]);
  }

  async findByIdempotencyKey(key: string): Promise<OrderView | null> {
    return this.load('SELECT * FROM orders WHERE idempotency_key = $1', [key]);
  }

  async listByCustomer(customerId: string, page: PageRequest): Promise<Page<OrderSummary>> {
    const limit = normalizeLimit(page.limit);
    const offset = (decodeCursor(page.cursor)?.offset as number | undefined) ?? 0;
    try {
      const db = await getPool();
      const result = await db.query<{
        id: string;
        status: OrderStatus;
        total_amount: string;
        currency: string;
        item_count: string;
        created_at: Date;
      }>(
        `SELECT o.id, o.status, o.total_amount, o.currency, o.created_at,
                COALESCE(SUM(i.quantity), 0) AS item_count
           FROM orders o
           LEFT JOIN order_items i ON i.order_id = o.id
          WHERE o.customer_id = $1
          GROUP BY o.id
          ORDER BY o.created_at DESC
          LIMIT $2 OFFSET $3`,
        [customerId, limit + 1, offset],
      );
      const rows = result.rows.slice(0, limit);
      return {
        items: rows.map((r) => ({
          id: r.id,
          status: r.status,
          total: { amount: Number(r.total_amount), currency: r.currency },
          itemCount: Number(r.item_count),
          createdAt: r.created_at.toISOString(),
        })),
        nextCursor:
          result.rows.length > limit ? encodeCursor({ offset: offset + limit }) : undefined,
      };
    } catch (err) {
      throw new DependencyFailureError('postgres', err);
    }
  }

  async updateStatus(orderId: string, next: OrderStatus, expected: OrderStatus[]): Promise<void> {
    try {
      const db = await getPool();
      const result = await db.query(
        `UPDATE orders SET status = $2, updated_at = now()
          WHERE id = $1 AND status = ANY($3::text[])`,
        [orderId, next, expected],
      );
      if (result.rowCount === 0) {
        throw new ConflictError(`order ${orderId} is not in an expected state for -> ${next}`, {
          orderId,
          expected,
        });
      }
    } catch (err) {
      if (err instanceof ConflictError) throw err;
      throw new DependencyFailureError('postgres', err);
    }
  }

  async savePayment(payment: Payment): Promise<void> {
    try {
      const db = await getPool();
      await db.query(
        `INSERT INTO payments
           (id, order_id, status, amount_amount, currency, provider, provider_ref, failure_reason, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           provider_ref = EXCLUDED.provider_ref,
           failure_reason = EXCLUDED.failure_reason,
           updated_at = now()`,
        [
          payment.id,
          payment.orderId,
          payment.status,
          payment.amount.amount,
          payment.amount.currency,
          payment.provider,
          payment.providerRef ?? null,
          payment.failureReason ?? null,
          payment.createdAt,
        ],
      );
    } catch (err) {
      throw new DependencyFailureError('postgres', err);
    }
  }

  async saveShipment(shipment: Shipment): Promise<void> {
    try {
      const db = await getPool();
      await db.query(
        `INSERT INTO shipments
           (id, order_id, status, address, carrier, tracking_number, provider_ref, estimated_delivery_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           carrier = EXCLUDED.carrier,
           tracking_number = EXCLUDED.tracking_number,
           provider_ref = EXCLUDED.provider_ref,
           estimated_delivery_date = EXCLUDED.estimated_delivery_date,
           updated_at = now()`,
        [
          shipment.id,
          shipment.orderId,
          shipment.status,
          JSON.stringify(shipment.address),
          shipment.carrier ?? null,
          shipment.trackingNumber ?? null,
          shipment.providerRef ?? null,
          shipment.estimatedDeliveryDate ?? null,
          shipment.createdAt,
        ],
      );
    } catch (err) {
      throw new DependencyFailureError('postgres', err);
    }
  }

  private async load(text: string, params: unknown[]): Promise<OrderView | null> {
    try {
      const db = await getPool();
      const orderResult = await db.query<OrderRow>(text, params);
      const orderRow = orderResult.rows[0];
      if (!orderRow) return null;

      const [items, payments, shipments] = await Promise.all([
        db.query<OrderItemRow>('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [
          orderRow.id,
        ]),
        db.query<PaymentRow>('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at', [
          orderRow.id,
        ]),
        db.query<ShipmentRow>('SELECT * FROM shipments WHERE order_id = $1 ORDER BY created_at', [
          orderRow.id,
        ]),
      ]);

      return toOrderView(orderRow, items.rows, payments.rows, shipments.rows);
    } catch (err) {
      throw new DependencyFailureError('postgres', err);
    }
  }
}

// --- row types --------------------------------------------------------------

interface OrderRow {
  id: string;
  customer_id: string;
  status: OrderStatus;
  currency: string;
  subtotal_amount: string;
  tax_amount: string;
  shipping_amount: string;
  total_amount: string;
  shipping_address: unknown;
  billing_address: unknown;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}
interface OrderItemRow {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  unit_price_amount: string;
  quantity: number;
  line_total_amount: string;
}
interface PaymentRow {
  id: string;
  order_id: string;
  status: Payment['status'];
  amount_amount: string;
  currency: string;
  provider: string;
  provider_ref: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}
interface ShipmentRow {
  id: string;
  order_id: string;
  status: Shipment['status'];
  address: unknown;
  carrier: string | null;
  tracking_number: string | null;
  provider_ref: string | null;
  estimated_delivery_date: Date | null;
  created_at: Date;
  updated_at: Date;
}

// --- mappers ---------------------------------------------------------------

const money = (amount: string | number, currency: string): Money => ({
  amount: Number(amount),
  currency,
});

async function insertOrder(tx: Queryable, order: Order): Promise<void> {
  await tx.query(
    `INSERT INTO orders
       (id, customer_id, status, currency, subtotal_amount, tax_amount, shipping_amount,
        total_amount, shipping_address, billing_address, idempotency_key, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      order.id,
      order.customerId,
      order.status,
      order.currency,
      order.subtotal.amount,
      order.tax.amount,
      order.shippingFee.amount,
      order.total.amount,
      JSON.stringify(order.shippingAddress),
      JSON.stringify(order.billingAddress),
      order.idempotencyKey ?? null,
      order.createdAt,
      order.updatedAt,
    ],
  );
}

async function insertPayment(tx: Queryable, payment: Payment, currency: string): Promise<void> {
  await tx.query(
    `INSERT INTO payments
       (id, order_id, status, amount_amount, currency, provider, provider_ref, failure_reason, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [
      payment.id,
      payment.orderId,
      payment.status,
      payment.amount.amount,
      currency,
      payment.provider,
      payment.providerRef ?? null,
      payment.failureReason ?? null,
      payment.createdAt,
    ],
  );
}

async function insertShipment(tx: Queryable, shipment: Shipment): Promise<void> {
  await tx.query(
    `INSERT INTO shipments
       (id, order_id, status, address, carrier, tracking_number, provider_ref, estimated_delivery_date, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [
      shipment.id,
      shipment.orderId,
      shipment.status,
      JSON.stringify(shipment.address),
      shipment.carrier ?? null,
      shipment.trackingNumber ?? null,
      shipment.providerRef ?? null,
      shipment.estimatedDeliveryDate ?? null,
      shipment.createdAt,
    ],
  );
}

function toOrderView(
  o: OrderRow,
  items: OrderItemRow[],
  payments: PaymentRow[],
  shipments: ShipmentRow[],
): OrderView {
  return {
    id: o.id,
    customerId: o.customer_id,
    status: o.status,
    currency: o.currency,
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      sku: i.sku,
      name: i.name,
      unitPrice: money(i.unit_price_amount, o.currency),
      quantity: i.quantity,
      lineTotal: money(i.line_total_amount, o.currency),
    })),
    subtotal: money(o.subtotal_amount, o.currency),
    tax: money(o.tax_amount, o.currency),
    shippingFee: money(o.shipping_amount, o.currency),
    total: money(o.total_amount, o.currency),
    shippingAddress: o.shipping_address as OrderView['shippingAddress'],
    billingAddress: o.billing_address as OrderView['billingAddress'],
    idempotencyKey: o.idempotency_key ?? undefined,
    createdAt: o.created_at.toISOString(),
    updatedAt: o.updated_at.toISOString(),
    payments: payments.map((p) => ({
      id: p.id,
      orderId: p.order_id,
      status: p.status,
      amount: money(p.amount_amount, p.currency),
      provider: p.provider,
      providerRef: p.provider_ref ?? undefined,
      failureReason: p.failure_reason ?? undefined,
      createdAt: p.created_at.toISOString(),
      updatedAt: p.updated_at.toISOString(),
    })),
    shipments: shipments.map((s) => ({
      id: s.id,
      orderId: s.order_id,
      status: s.status,
      address: s.address as Shipment['address'],
      carrier: s.carrier ?? undefined,
      trackingNumber: s.tracking_number ?? undefined,
      providerRef: s.provider_ref ?? undefined,
      estimatedDeliveryDate: s.estimated_delivery_date?.toISOString().slice(0, 10),
      createdAt: s.created_at.toISOString(),
      updatedAt: s.updated_at.toISOString(),
    })),
  };
}
