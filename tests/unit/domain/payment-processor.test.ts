import {
  InMemoryCustomerRepository,
  InMemoryIdempotencyStore,
  InMemoryOrderRepository,
  InMemoryProductRepository,
  PaymentProcessor,
  createCustomer,
  createOrder,
  money,
  newPayment,
  newShipment,
  type PaymentRequestedPayload,
} from '@cloud-commerce/domain';
import { InMemoryEventPublisher } from '@cloud-commerce/events';
import { MockPaymentProvider } from '@cloud-commerce/integrations';
import { beforeEach, describe, expect, it } from 'vitest';

const address = {
  name: 'A',
  line1: '1 St',
  city: 'C',
  region: 'R',
  postalCode: '00000',
  country: 'US',
};

describe('PaymentProcessor', () => {
  let orders: InMemoryOrderRepository;
  let events: InMemoryEventPublisher;
  let idempotency: InMemoryIdempotencyStore;
  let payload: PaymentRequestedPayload;
  let orderId: string;

  beforeEach(async () => {
    orders = new InMemoryOrderRepository();
    events = new InMemoryEventPublisher();
    idempotency = new InMemoryIdempotencyStore();
    void new InMemoryCustomerRepository([createCustomer({ email: 'a@b.com', name: 'A' })]);
    void new InMemoryProductRepository();

    const order = createOrder({
      customerId: 'cust_1',
      lines: [{ productId: 'p1', sku: 'S1', name: 'X', unitPrice: money(2500), quantity: 1 }],
      shippingAddress: address,
      billingAddress: address,
    });
    orderId = order.id;
    const payment = newPayment({ orderId: order.id, amount: order.total, provider: 'mock' });
    await orders.create({ order, payment, shipment: newShipment({ orderId: order.id, address }) });

    payload = {
      orderId: order.id,
      paymentId: payment.id,
      customerId: 'cust_1',
      amount: order.total,
    };
  });

  const processor = (sim = {}) =>
    new PaymentProcessor({
      orders,
      provider: new MockPaymentProvider(sim),
      events,
      idempotency,
    });

  it('captures payment, confirms the order, publishes PaymentCompleted', async () => {
    await processor({ force: 'success' }).process(payload, 'corr-1');

    const order = await orders.findById(orderId);
    expect(order!.status).toBe('confirmed');
    expect(order!.payments.some((p) => p.status === 'captured')).toBe(true);
    expect(events.byName('PaymentCompleted')).toHaveLength(1);
  });

  it('on decline: marks payment failed, publishes PaymentFailed (non-retryable), acks', async () => {
    await processor({ force: 'decline' }).process(payload, 'corr-1');
    const order = await orders.findById(orderId);
    expect(order!.status).toBe('pending');
    const failed = events.byName('PaymentFailed')[0];
    expect((failed!.payload as { retryable: boolean }).retryable).toBe(false);
  });

  it('on a transient error: rethrows (SQS retry) and releases the idempotency claim', async () => {
    await expect(processor({ force: 'server_error' }).process(payload, 'corr-1')).rejects.toThrow();
    expect(idempotency.size).toBe(0); // claim released for retry
    expect(events.byName('PaymentCompleted')).toHaveLength(0);
  });

  it('is idempotent — a second delivery is a no-op', async () => {
    const p = processor({ force: 'success' });
    await p.process(payload, 'corr-1');
    await p.process(payload, 'corr-1');
    expect(events.byName('PaymentCompleted')).toHaveLength(1);
  });
});
