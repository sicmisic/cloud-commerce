import {
  CatalogService,
  InMemoryCustomerRepository,
  InMemoryIdempotencyStore,
  InMemoryOrderRepository,
  InMemoryProductRepository,
  OrderService,
  PaymentProcessor,
  createCustomer,
  createOrder,
  createProduct,
  money,
  newPayment,
  newShipment,
  type MetricsSink,
  type PaymentRequestedPayload,
} from '@cloud-commerce/domain';
import { InMemoryEventPublisher } from '@cloud-commerce/events';
import { MockPaymentProvider } from '@cloud-commerce/integrations';
import { beforeEach, describe, expect, it } from 'vitest';

class RecordingMetrics implements MetricsSink {
  counts: Record<string, number> = {};
  increment(name: string, value = 1): void {
    this.counts[name] = (this.counts[name] ?? 0) + value;
  }
}

const address = {
  name: 'A',
  line1: '1',
  city: 'C',
  region: 'R',
  postalCode: '00000',
  country: 'US',
};

describe('business metrics', () => {
  let metrics: RecordingMetrics;

  beforeEach(() => {
    metrics = new RecordingMetrics();
  });

  it('OrderService emits OrdersCreated on success', async () => {
    const widget = createProduct({
      sku: 'm-widget',
      name: 'W',
      description: 'w',
      category: 'c',
      price: money(1000),
      initialStock: 5,
    });
    const products = new InMemoryProductRepository([widget]);
    const customer = createCustomer({ email: 'a@b.com', name: 'A' });
    const service = new OrderService({
      customers: new InMemoryCustomerRepository([customer]),
      catalog: new CatalogService(products),
      orders: new InMemoryOrderRepository(),
      events: new InMemoryEventPublisher(),
      paymentProviderName: 'mock',
      metrics,
    });

    await service.createOrder({
      customerId: customer.id,
      correlationId: 'c',
      lines: [{ productId: widget.id, quantity: 1 }],
      shippingAddress: address,
      billingAddress: address,
    });
    expect(metrics.counts.OrdersCreated).toBe(1);
    expect(metrics.counts.OrdersFailed).toBeUndefined();
  });

  it('OrderService emits OrdersFailed + InventoryReservationFailures when out of stock', async () => {
    const widget = createProduct({
      sku: 'm-widget-2',
      name: 'W',
      description: 'w',
      category: 'c',
      price: money(1000),
      initialStock: 0,
    });
    const products = new InMemoryProductRepository([widget]);
    const customer = createCustomer({ email: 'a@b.com', name: 'A' });
    const service = new OrderService({
      customers: new InMemoryCustomerRepository([customer]),
      catalog: new CatalogService(products),
      orders: new InMemoryOrderRepository(),
      events: new InMemoryEventPublisher(),
      paymentProviderName: 'mock',
      metrics,
    });

    await expect(
      service.createOrder({
        customerId: customer.id,
        correlationId: 'c',
        lines: [{ productId: widget.id, quantity: 1 }],
        shippingAddress: address,
        billingAddress: address,
      }),
    ).rejects.toThrow();
    expect(metrics.counts.OrdersFailed).toBe(1);
    expect(metrics.counts.InventoryReservationFailures).toBe(1);
  });

  it('PaymentProcessor emits PaymentFailures on decline', async () => {
    const orders = new InMemoryOrderRepository();
    const order = createOrder({
      customerId: 'c1',
      lines: [{ productId: 'p', sku: 'S', name: 'X', unitPrice: money(500), quantity: 1 }],
      shippingAddress: address,
      billingAddress: address,
    });
    const payment = newPayment({ orderId: order.id, amount: order.total, provider: 'mock' });
    await orders.create({ order, payment, shipment: newShipment({ orderId: order.id, address }) });

    const processor = new PaymentProcessor({
      orders,
      provider: new MockPaymentProvider({ force: 'decline' }),
      events: new InMemoryEventPublisher(),
      idempotency: new InMemoryIdempotencyStore(),
      metrics,
    });
    const payload: PaymentRequestedPayload = {
      orderId: order.id,
      paymentId: payment.id,
      customerId: 'c1',
      amount: order.total,
    };
    await processor.process(payload, 'c');
    expect(metrics.counts.PaymentFailures).toBe(1);
  });
});
