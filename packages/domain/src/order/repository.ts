import { type Page, type PageRequest } from '../shared/pagination';

import { type Order, type OrderStatus } from './order';
import { type Payment } from './payment';
import { type Shipment } from './shipment';

/** Full order aggregate as stored — the order plus its payments and shipments. */
export interface OrderView extends Order {
  readonly payments: Payment[];
  readonly shipments: Shipment[];
}

export interface OrderSummary {
  readonly id: string;
  readonly status: OrderStatus;
  readonly total: Order['total'];
  readonly itemCount: number;
  readonly createdAt: string;
}

export interface NewOrderRecord {
  readonly order: Order;
  readonly payment: Payment;
  readonly shipment: Shipment;
}

/**
 * Persistence port for orders (PostgreSQL). `create` writes the order, its
 * items, the initial payment, and the initial shipment in **one transaction**
 * — a partial order must never exist.
 */
export interface OrderRepository {
  create(record: NewOrderRecord): Promise<void>;
  findById(id: string): Promise<OrderView | null>;
  findByIdempotencyKey(key: string): Promise<OrderView | null>;
  listByCustomer(customerId: string, page: PageRequest): Promise<Page<OrderSummary>>;

  /**
   * Move the order to `next`, asserting the current status is one of
   * `expected` (optimistic guard). Throws `ConflictError` on mismatch.
   */
  updateStatus(orderId: string, next: OrderStatus, expected: OrderStatus[]): Promise<void>;

  /** Append / replace a payment row (worker updates on capture/failure). */
  savePayment(payment: Payment): Promise<void>;

  /** Append / replace a shipment row (worker updates on dispatch). */
  saveShipment(shipment: Shipment): Promise<void>;
}
