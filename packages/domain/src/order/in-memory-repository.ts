import { ConflictError } from '../shared/errors';
import {
  type Page,
  type PageRequest,
  encodeCursor,
  decodeCursor,
  normalizeLimit,
} from '../shared/pagination';

import { type OrderStatus } from './order';
import { type Payment } from './payment';
import {
  type NewOrderRecord,
  type OrderRepository,
  type OrderSummary,
  type OrderView,
} from './repository';
import { type Shipment } from './shipment';

/**
 * In-memory {@link OrderRepository} for unit / E2E tests. `create` is atomic by
 * construction (single map write); the PostgreSQL implementation gets the same
 * guarantee from a transaction.
 */
export class InMemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<string, OrderView>();

  async create(record: NewOrderRecord): Promise<void> {
    if (this.orders.has(record.order.id)) {
      throw new ConflictError(`order ${record.order.id} already exists`);
    }
    if (
      record.order.idempotencyKey &&
      (await this.findByIdempotencyKey(record.order.idempotencyKey))
    ) {
      throw new ConflictError('idempotency key already used');
    }
    this.orders.set(record.order.id, {
      ...record.order,
      payments: [record.payment],
      shipments: [record.shipment],
    });
  }

  async findById(id: string): Promise<OrderView | null> {
    return this.orders.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<OrderView | null> {
    for (const o of this.orders.values()) if (o.idempotencyKey === key) return o;
    return null;
  }

  async listByCustomer(customerId: string, page: PageRequest): Promise<Page<OrderSummary>> {
    const limit = normalizeLimit(page.limit);
    const all = [...this.orders.values()]
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = (decodeCursor(page.cursor)?.offset as number | undefined) ?? 0;
    const slice = all.slice(offset, offset + limit);
    return {
      items: slice.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total,
        itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
        createdAt: o.createdAt,
      })),
      nextCursor:
        offset + limit < all.length ? encodeCursor({ offset: offset + limit }) : undefined,
    };
  }

  async updateStatus(orderId: string, next: OrderStatus, expected: OrderStatus[]): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) throw new ConflictError(`order ${orderId} not found`);
    if (!expected.includes(order.status)) {
      throw new ConflictError(
        `order ${orderId} is ${order.status}, expected one of ${expected.join(',')}`,
      );
    }
    this.orders.set(orderId, { ...order, status: next, updatedAt: new Date().toISOString() });
  }

  async savePayment(payment: Payment): Promise<void> {
    const order = this.orders.get(payment.orderId);
    if (!order) return;
    const payments = order.payments.filter((p) => p.id !== payment.id);
    payments.push(payment);
    this.orders.set(order.id, { ...order, payments });
  }

  async saveShipment(shipment: Shipment): Promise<void> {
    const order = this.orders.get(shipment.orderId);
    if (!order) return;
    const shipments = order.shipments.filter((s) => s.id !== shipment.id);
    shipments.push(shipment);
    this.orders.set(order.id, { ...order, shipments });
  }

  all(): OrderView[] {
    return [...this.orders.values()];
  }
}
