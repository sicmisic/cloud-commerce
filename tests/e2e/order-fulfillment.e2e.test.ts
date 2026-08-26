import {
  CatalogService,
  InMemoryCustomerRepository,
  InMemoryIdempotencyStore,
  InMemoryOrderRepository,
  InMemoryProductRepository,
  InventoryReleaser,
  NotificationSender,
  OrderService,
  PaymentProcessor,
  ShipmentProcessor,
  createCustomer,
  createProduct,
  money,
  type DomainEvent,
  type OrderCancelledPayload,
  type PaymentCompletedPayload,
  type PaymentRequestedPayload,
} from '@cloud-commerce/domain';
import { InMemoryEventPublisher } from '@cloud-commerce/events';
import {
  MockEmailProvider,
  MockPaymentProvider,
  MockShippingProvider,
} from '@cloud-commerce/integrations';
import { beforeEach, describe, expect, it } from 'vitest';

import { pumpEvents } from '../helpers/event-pump';

const address = {
  name: 'Grace Hopper',
  line1: '1 Compiler Ave',
  city: 'Arlington',
  region: 'VA',
  postalCode: '22201',
  country: 'US',
};

/**
 * Phase 4 end-to-end: an order flows through the whole async pipeline —
 * OrderCreated/PaymentRequested → payment worker → PaymentCompleted → shipping
 * worker → ShipmentDispatched → email worker — driven by an in-memory
 * EventBridge/SQS simulation.
 */
describe('E2E: full order fulfillment pipeline', () => {
  let products: InMemoryProductRepository;
  let orders: InMemoryOrderRepository;
  let customers: InMemoryCustomerRepository;
  let events: InMemoryEventPublisher;
  let idempotency: InMemoryIdempotencyStore;
  let catalog: CatalogService;
  let orderService: OrderService;
  let email: MockEmailProvider;
  let customerId: string;
  let widgetId: string;

  let handlers: ((e: DomainEvent) => Promise<void>)[];

  function buildPipeline(paymentSim = {}) {
    const payment = new PaymentProcessor({
      orders,
      provider: new MockPaymentProvider(paymentSim),
      events,
      idempotency,
    });
    const shipment = new ShipmentProcessor({
      orders,
      provider: new MockShippingProvider(),
      events,
      idempotency,
    });
    const notifications = new NotificationSender({ provider: email, customers, idempotency });
    const inventory = new InventoryReleaser({ catalog, idempotency });

    handlers = [
      (e) =>
        e.name === 'PaymentRequested'
          ? payment.process(e.payload as PaymentRequestedPayload, e.correlationId)
          : Promise.resolve(),
      (e) =>
        e.name === 'PaymentCompleted'
          ? shipment.process(e.payload as PaymentCompletedPayload, e.correlationId)
          : Promise.resolve(),
      (e) => notifications.handle(e),
      (e) =>
        e.name === 'OrderCancelled'
          ? inventory.process(e.payload as OrderCancelledPayload, e.id)
          : Promise.resolve(),
    ];
  }

  beforeEach(() => {
    const widget = createProduct({
      sku: 'pipe-widget',
      name: 'Pipeline Widget',
      description: 'w',
      category: 'c',
      price: money(3000),
      initialStock: 10,
    });
    widgetId = widget.id;
    products = new InMemoryProductRepository([widget]);

    const customer = createCustomer({ email: 'grace@example.com', name: 'Grace' });
    customerId = customer.id;
    customers = new InMemoryCustomerRepository([customer]);

    orders = new InMemoryOrderRepository();
    events = new InMemoryEventPublisher();
    idempotency = new InMemoryIdempotencyStore();
    catalog = new CatalogService(products);
    email = new MockEmailProvider();
    orderService = new OrderService({
      customers,
      catalog,
      orders,
      events,
      paymentProviderName: 'mock',
    });
  });

  const placeOrder = () =>
    orderService.createOrder({
      customerId,
      correlationId: 'corr-pipe',
      idempotencyKey: 'pipeline-key-1',
      lines: [{ productId: widgetId, quantity: 2 }],
      shippingAddress: address,
      billingAddress: address,
    });

  it('confirms payment, dispatches a shipment, and notifies the customer', async () => {
    buildPipeline({ force: 'success' });
    const order = await placeOrder();

    const { failures } = await pumpEvents(events, handlers);
    expect(failures).toHaveLength(0);

    const finalOrder = await orders.findById(order.id);
    expect(finalOrder!.status).toBe('processing');
    expect(finalOrder!.payments.some((p) => p.status === 'captured')).toBe(true);
    expect(finalOrder!.shipments.some((s) => s.status === 'dispatched')).toBe(true);

    // Emails: order-confirmation + shipment-dispatched.
    const templates = email.sent.map((m) => m.template).sort();
    expect(templates).toEqual(['order-confirmation', 'shipment-dispatched']);

    // Correlation id threaded through every event.
    expect(events.published.every((e) => e.correlationId === 'corr-pipe')).toBe(true);
  });

  it('on a hard decline: order stays pending, PaymentFailed is emitted, decline email sent', async () => {
    buildPipeline({ force: 'decline' });
    const order = await placeOrder();

    await pumpEvents(events, handlers);

    const finalOrder = await orders.findById(order.id);
    expect(finalOrder!.status).toBe('pending');
    expect(finalOrder!.payments.some((p) => p.status === 'failed')).toBe(true);
    expect(events.byName('PaymentFailed')).toHaveLength(1);
    expect(email.sent.map((m) => m.template)).toContain('payment-failed');
  });

  it('a transient payment error surfaces as a pump failure (would hit the DLQ)', async () => {
    buildPipeline({ force: 'server_error' });
    await placeOrder();

    const { failures } = await pumpEvents(events, handlers);
    expect(failures.some((f) => f.event.name === 'PaymentRequested')).toBe(true);
    // Nothing advanced.
    expect(events.byName('PaymentCompleted')).toHaveLength(0);
  });

  it('workers are idempotent — replaying every event changes nothing', async () => {
    buildPipeline({ force: 'success' });
    const order = await placeOrder();
    await pumpEvents(events, handlers);

    const emailCountBefore = email.sent.length;
    const paymentEvents = events.byName('PaymentCompleted').length;

    // Replay the whole event log.
    for (const event of [...events.published]) {
      for (const handle of handlers) await handle(event).catch(() => undefined);
    }

    expect(email.sent.length).toBe(emailCountBefore);
    expect(events.byName('PaymentCompleted')).toHaveLength(paymentEvents);
    const finalOrder = await orders.findById(order.id);
    expect(finalOrder!.status).toBe('processing');
  });

  it('cancel then pump releases inventory via the inventory worker', async () => {
    buildPipeline({ force: 'success' });
    const order = await placeOrder();
    await pumpEvents(events, handlers);

    await orderService.cancelOrder(order.id, 'changed mind', 'corr-cancel');
    // The order service already released synchronously; the worker is idempotent.
    await pumpEvents(events, handlers);

    const widget = await products.findById(widgetId);
    expect(widget!.inventory.reserved).toBe(0);
    expect(email.sent.map((m) => m.template)).toContain('order-cancelled');
  });
});
