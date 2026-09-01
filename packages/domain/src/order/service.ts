import { type CustomerRepository } from '../customer/repository';
import { type CatalogService } from '../product/service';
import {
  ConflictError,
  InsufficientInventoryError,
  NotFoundError,
  ValidationError,
} from '../shared/errors';
import { type EventPublisher } from '../shared/events';
import { type Logger, noopLogger } from '../shared/logger';
import { BUSINESS_METRIC, type MetricsSink, noopMetrics } from '../shared/metrics';
import { type Page, type PageRequest } from '../shared/pagination';

import { orderCancelledEvent, orderCreatedEvent, paymentRequestedEvent } from './events';
import {
  type Address,
  type Order,
  type PricedLine,
  assertCurrency,
  createOrder,
  isTerminal,
} from './order';
import { newPayment } from './payment';
import { type OrderRepository, type OrderSummary, type OrderView } from './repository';
import { newShipment } from './shipment';

export interface OrderServiceDeps {
  readonly customers: CustomerRepository;
  readonly catalog: CatalogService;
  readonly orders: OrderRepository;
  readonly events: EventPublisher;
  /** Provider name recorded on the initial payment row (mock/stripe). */
  readonly paymentProviderName: string;
  readonly logger?: Logger;
  readonly metrics?: MetricsSink;
}

export interface CreateOrderCommand {
  readonly customerId: string;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly lines: { productId: string; quantity: number }[];
  readonly shippingAddress: Address;
  readonly billingAddress: Address;
}

/**
 * The order use cases. `createOrder` is the crux of the system: it spans two
 * datastores (DynamoDB catalog + PostgreSQL orders) and must not leave
 * inventory reserved for an order that was never persisted. Compensation
 * (release reserved units) runs on every failure path after reservation.
 */
export class OrderService {
  private readonly log: Logger;
  private readonly metrics: MetricsSink;

  constructor(private readonly deps: OrderServiceDeps) {
    this.log = deps.logger ?? noopLogger;
    this.metrics = deps.metrics ?? noopMetrics;
  }

  async createOrder(cmd: CreateOrderCommand): Promise<OrderView> {
    await this.requireCustomer(cmd.customerId);

    if (cmd.idempotencyKey) {
      const existing = await this.deps.orders.findByIdempotencyKey(cmd.idempotencyKey);
      if (existing) {
        this.log.info(
          { idempotencyKey: cmd.idempotencyKey, orderId: existing.id },
          'idempotent replay',
        );
        this.metrics.increment(BUSINESS_METRIC.IdempotentReplay);
        return existing;
      }
    }

    const pricedLines = await this.priceLines(cmd.lines);
    assertCurrency(pricedLines);

    const reserved: { productId: string; quantity: number }[] = [];
    try {
      for (const line of pricedLines) {
        await this.deps.catalog.reserve(line.productId, line.quantity);
        reserved.push({ productId: line.productId, quantity: line.quantity });
      }

      const order = createOrder({
        customerId: cmd.customerId,
        lines: pricedLines,
        shippingAddress: cmd.shippingAddress,
        billingAddress: cmd.billingAddress,
        idempotencyKey: cmd.idempotencyKey,
      });
      const payment = newPayment({
        orderId: order.id,
        amount: order.total,
        provider: this.deps.paymentProviderName,
      });
      const shipment = newShipment({ orderId: order.id, address: cmd.shippingAddress });

      await this.deps.orders.create({ order, payment, shipment });

      // Fan-out: inventory is already reserved synchronously; payment / email /
      // shipping happen in workers (Phase 4).
      await this.publishSafely(
        [
          orderCreatedEvent(order, cmd.correlationId),
          paymentRequestedEvent(order, payment.id, cmd.correlationId),
        ],
        order.id,
      );

      this.log.info({ orderId: order.id, total: order.total.amount }, 'order created');
      this.metrics.increment(BUSINESS_METRIC.OrdersCreated);
      return { ...order, payments: [payment], shipments: [shipment] };
    } catch (err) {
      this.metrics.increment(BUSINESS_METRIC.OrdersFailed);
      if (err instanceof InsufficientInventoryError) {
        this.metrics.increment(BUSINESS_METRIC.InventoryReservationFailures);
      }
      await this.compensate(reserved);
      throw err;
    }
  }

  async getOrder(orderId: string): Promise<OrderView> {
    const order = await this.deps.orders.findById(orderId);
    if (!order) throw new NotFoundError('Order', orderId);
    return order;
  }

  async listCustomerOrders(customerId: string, page: PageRequest): Promise<Page<OrderSummary>> {
    await this.requireCustomer(customerId);
    return this.deps.orders.listByCustomer(customerId, page);
  }

  async cancelOrder(orderId: string, reason: string, correlationId: string): Promise<OrderView> {
    const order = await this.getOrder(orderId);
    if (isTerminal(order.status)) {
      throw new ConflictError(`order ${orderId} is already ${order.status}`, { orderId });
    }

    await this.deps.orders.updateStatus(orderId, 'cancelled', [
      'pending',
      'confirmed',
      'processing',
    ]);

    // Release every reserved unit back to the catalog.
    for (const item of order.items) {
      await this.deps.catalog.release(item.productId, item.quantity).catch((err) => {
        this.log.error(
          { err, orderId, productId: item.productId },
          'inventory release failed on cancel',
        );
      });
    }

    await this.publishSafely([orderCancelledEvent(order, reason, correlationId)], orderId);

    return { ...order, status: 'cancelled', updatedAt: new Date().toISOString() };
  }

  private async requireCustomer(customerId: string): Promise<void> {
    const customer = await this.deps.customers.findById(customerId);
    if (!customer) throw new NotFoundError('Customer', customerId);
  }

  private async priceLines(
    lines: { productId: string; quantity: number }[],
  ): Promise<PricedLine[]> {
    if (lines.length === 0) {
      throw new ValidationError('an order must contain at least one line');
    }
    // Collapse duplicate product ids into one line.
    const merged = new Map<string, number>();
    for (const line of lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new ValidationError('line quantity must be a positive integer', line);
      }
      merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
    }

    const priced: PricedLine[] = [];
    for (const [productId, quantity] of merged) {
      const product = await this.deps.catalog.getById(productId);
      if (product.status !== 'active') {
        throw new ValidationError(`product ${productId} is not available for purchase`, {
          productId,
          status: product.status,
        });
      }
      priced.push({
        productId,
        sku: product.sku,
        name: product.name,
        unitPrice: product.price, // server price — the client's price is ignored
        quantity,
      });
    }
    return priced;
  }

  private async compensate(reserved: { productId: string; quantity: number }[]): Promise<void> {
    for (const r of reserved) {
      await this.deps.catalog.release(r.productId, r.quantity).catch((err) => {
        this.log.error({ err, ...r }, 'compensation release failed — inventory may be stuck');
      });
    }
  }

  private async publishSafely(events: Parameters<EventPublisher['publish']>[0][], orderId: string) {
    try {
      await this.deps.events.publishBatch(events);
    } catch (err) {
      // The order is persisted; a failed publish is recoverable via the
      // outbox / replay path (documented follow-up). Do not fail the request.
      this.log.error({ err, orderId }, 'event publish failed after order persisted');
    }
  }
}

// Re-export the type for callers building an order aggregate response.
export type { OrderView };
export type { Order };
