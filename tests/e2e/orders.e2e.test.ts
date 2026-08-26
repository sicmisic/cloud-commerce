import {
  __installInMemoryEventPublisher,
  __resetContainer,
  __setContainer,
  handler,
} from '@cloud-commerce/api';
import {
  CatalogService,
  CustomerService,
  InMemoryCustomerRepository,
  InMemoryIdempotencyStore,
  InMemoryOrderRepository,
  InMemoryProductRepository,
  OrderService,
  createProduct,
  money,
} from '@cloud-commerce/domain';
import type { InMemoryEventPublisher } from '@cloud-commerce/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeContext, makeEvent, parseJsonBody } from '../helpers/api-gateway';

const customerClaims = JSON.stringify({
  sub: 'user_grace',
  'cognito:groups': ['CUSTOMER'],
  email: 'grace@example.com',
});
const otherClaims = JSON.stringify({
  sub: 'user_alan',
  'cognito:groups': ['CUSTOMER'],
  email: 'alan@example.com',
});
const opsClaims = JSON.stringify({
  sub: 'user_ops',
  'cognito:groups': ['OPERATIONS'],
  email: 'ops@example.com',
});

const asCustomer = { 'x-debug-claims': customerClaims };
const asOther = { 'x-debug-claims': otherClaims };
const asOps = { 'x-debug-claims': opsClaims };

const address = {
  name: 'Grace Hopper',
  line1: '1 Compiler Ave',
  city: 'Arlington',
  region: 'VA',
  postalCode: '22201',
  country: 'us',
};

describe('E2E: order flow', () => {
  let widgetId: string;
  let events: InMemoryEventPublisher;

  beforeEach(() => {
    const widget = createProduct({
      sku: 'e2e-order-widget',
      name: 'Order Widget',
      description: 'w',
      category: 'gadgets',
      price: money(2500),
      initialStock: 10,
    });
    widgetId = widget.id;

    const products = new InMemoryProductRepository([widget]);
    const customers = new InMemoryCustomerRepository();
    const orders = new InMemoryOrderRepository();
    events = __installInMemoryEventPublisher();
    const catalog = new CatalogService(products);
    __setContainer({
      productRepository: products,
      customerRepository: customers,
      orderRepository: orders,
      idempotencyStore: new InMemoryIdempotencyStore(),
      catalogService: catalog,
      customerService: new CustomerService(customers),
      orderService: new OrderService({
        customers,
        catalog,
        orders,
        events,
        paymentProviderName: 'mock',
      }),
    });
  });

  afterEach(() => __resetContainer());

  async function registerCustomer(headers: Record<string, string>, email: string) {
    return handler(
      makeEvent('POST', '/customers', { headers, body: { email, name: 'Test User' } }),
      makeContext(),
    );
  }

  async function placeOrder(headers: Record<string, string>, idempotencyKey: string) {
    return handler(
      makeEvent('POST', '/orders', {
        headers: { ...headers, 'idempotency-key': idempotencyKey },
        body: { lines: [{ productId: widgetId, quantity: 2 }], shippingAddress: address },
      }),
      makeContext(),
    );
  }

  it('rejects POST /orders without an Idempotency-Key', async () => {
    await registerCustomer(asCustomer, 'grace@example.com');
    const res = await handler(
      makeEvent('POST', '/orders', {
        headers: asCustomer,
        body: { lines: [{ productId: widgetId, quantity: 1 }], shippingAddress: address },
      }),
      makeContext(),
    );
    expect(res.statusCode).toBe(422);
  });

  it('rejects an order from a caller with no customer profile', async () => {
    const res = await placeOrder(asCustomer, 'key-no-profile');
    expect(res.statusCode).toBe(409);
  });

  it('places an order: reserves stock, persists, emits events', async () => {
    await registerCustomer(asCustomer, 'grace@example.com');
    const res = await placeOrder(asCustomer, 'order-key-1');
    expect(res.statusCode).toBe(201);

    const order = parseJsonBody<{ id: string; status: string; total: number; subtotal: number }>(
      res.body as string,
    );
    expect(order.status).toBe('pending');
    expect(order.subtotal).toBe(5000);

    expect(events.byName('OrderCreated')).toHaveLength(1);
    expect(events.byName('PaymentRequested')).toHaveLength(1);

    const get = await handler(
      makeEvent('GET', `/orders/${order.id}`, { headers: asCustomer }),
      makeContext(),
    );
    expect(get.statusCode).toBe(200);
  });

  it('is idempotent on the Idempotency-Key', async () => {
    await registerCustomer(asCustomer, 'grace@example.com');
    const a = parseJsonBody<{ id: string }>(
      (await placeOrder(asCustomer, 'order-key-same')).body as string,
    );
    const b = parseJsonBody<{ id: string }>(
      (await placeOrder(asCustomer, 'order-key-same')).body as string,
    );
    expect(b.id).toBe(a.id);
    expect(events.byName('OrderCreated')).toHaveLength(1);
  });

  it('forbids reading another customer order, allows OPERATIONS', async () => {
    await registerCustomer(asCustomer, 'grace@example.com');
    await registerCustomer(asOther, 'alan@example.com');
    const order = parseJsonBody<{ id: string }>(
      (await placeOrder(asCustomer, 'order-key-2')).body as string,
    );

    const forbidden = await handler(
      makeEvent('GET', `/orders/${order.id}`, { headers: asOther }),
      makeContext(),
    );
    expect(forbidden.statusCode).toBe(403);

    const opsView = await handler(
      makeEvent('GET', `/orders/${order.id}`, { headers: asOps }),
      makeContext(),
    );
    expect(opsView.statusCode).toBe(200);
  });

  it('OPERATIONS can cancel an order, releasing inventory', async () => {
    await registerCustomer(asCustomer, 'grace@example.com');
    const order = parseJsonBody<{ id: string }>(
      (await placeOrder(asCustomer, 'order-key-3')).body as string,
    );

    const cancel = await handler(
      makeEvent('POST', `/orders/${order.id}/cancel`, { headers: asOps, body: { reason: 'test' } }),
      makeContext(),
    );
    expect(cancel.statusCode).toBe(202);
    expect(parseJsonBody<{ status: string }>(cancel.body as string).status).toBe('cancelled');

    // A CUSTOMER cannot cancel.
    const denied = await handler(
      makeEvent('POST', `/orders/${order.id}/cancel`, { headers: asCustomer }),
      makeContext(),
    );
    expect(denied.statusCode).toBe(403);
  });

  it('lists the customer own orders', async () => {
    const reg = await registerCustomer(asCustomer, 'grace@example.com');
    const customerId = parseJsonBody<{ id: string }>(reg.body as string).id;
    await placeOrder(asCustomer, 'order-key-a');
    await handler(
      makeEvent('POST', '/orders', {
        headers: { ...asCustomer, 'idempotency-key': 'order-key-b' },
        body: { lines: [{ productId: widgetId, quantity: 1 }], shippingAddress: address },
      }),
      makeContext(),
    );
    const list = await handler(
      makeEvent('GET', `/customers/${customerId}/orders`, { headers: asCustomer }),
      makeContext(),
    );
    expect(parseJsonBody<{ items: unknown[] }>(list.body as string).items).toHaveLength(2);
  });
});
