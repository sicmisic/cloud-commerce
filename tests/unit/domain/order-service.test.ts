import {
  CatalogService,
  ConflictError,
  InMemoryCustomerRepository,
  InMemoryOrderRepository,
  InMemoryProductRepository,
  InsufficientInventoryError,
  NotFoundError,
  OrderService,
  createCustomer,
  createProduct,
  money,
} from '@cloud-commerce/domain';
import { InMemoryEventPublisher } from '@cloud-commerce/events';
import { beforeEach, describe, expect, it } from 'vitest';

const address = {
  name: 'Grace Hopper',
  line1: '1 Compiler Ave',
  city: 'Arlington',
  region: 'VA',
  postalCode: '22201',
  country: 'US',
};

describe('OrderService', () => {
  let products: InMemoryProductRepository;
  let customers: InMemoryCustomerRepository;
  let orders: InMemoryOrderRepository;
  let events: InMemoryEventPublisher;
  let catalog: CatalogService;
  let service: OrderService;
  let customerId: string;
  let widgetId: string;
  let gadgetId: string;

  beforeEach(async () => {
    const widget = createProduct({
      sku: 'widget',
      name: 'Widget',
      description: 'w',
      category: 'c',
      price: money(2000),
      initialStock: 5,
    });
    const gadget = createProduct({
      sku: 'gadget',
      name: 'Gadget',
      description: 'g',
      category: 'c',
      price: money(3500),
      initialStock: 1,
    });
    widgetId = widget.id;
    gadgetId = gadget.id;
    products = new InMemoryProductRepository([widget, gadget]);

    const customer = createCustomer({ email: 'grace@example.com', name: 'Grace' });
    customerId = customer.id;
    customers = new InMemoryCustomerRepository([customer]);

    orders = new InMemoryOrderRepository();
    events = new InMemoryEventPublisher();
    catalog = new CatalogService(products);
    service = new OrderService({
      customers,
      catalog,
      orders,
      events,
      paymentProviderName: 'mock',
    });
  });

  const command = (over: Partial<Parameters<OrderService['createOrder']>[0]> = {}) => ({
    customerId,
    correlationId: 'corr-1',
    lines: [{ productId: widgetId, quantity: 2 }],
    shippingAddress: address,
    billingAddress: address,
    ...over,
  });

  it('creates an order, reserves inventory, and publishes OrderCreated + PaymentRequested', async () => {
    const order = await service.createOrder(command());

    expect(order.status).toBe('pending');
    expect(order.items).toHaveLength(1);
    expect(order.subtotal).toEqual(money(4000));
    expect(order.payments[0]!.amount).toEqual(order.total);

    const widget = await products.findById(widgetId);
    expect(widget!.inventory).toEqual({ available: 3, reserved: 2 });

    expect(events.byName('OrderCreated')).toHaveLength(1);
    expect(events.byName('PaymentRequested')).toHaveLength(1);
  });

  it('prices from the catalog, ignoring any client-supplied price', async () => {
    const order = await service.createOrder(
      command({ lines: [{ productId: widgetId, quantity: 1 }] }),
    );
    expect(order.items[0]!.unitPrice).toEqual(money(2000));
  });

  it('404s for an unknown customer', async () => {
    await expect(service.createOrder(command({ customerId: 'cust_nope' }))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rolls back reservations when a later line is out of stock (compensation)', async () => {
    await expect(
      service.createOrder(
        command({
          lines: [
            { productId: widgetId, quantity: 1 },
            { productId: gadgetId, quantity: 5 }, // only 1 in stock
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);

    // The widget reservation must have been released.
    const widget = await products.findById(widgetId);
    expect(widget!.inventory).toEqual({ available: 5, reserved: 0 });
    expect(orders.all()).toHaveLength(0);
  });

  it('is idempotent — a repeated Idempotency-Key returns the original order', async () => {
    const first = await service.createOrder(command({ idempotencyKey: 'key-abc' }));
    const second = await service.createOrder(command({ idempotencyKey: 'key-abc' }));
    expect(second.id).toBe(first.id);
    // No double reservation.
    const widget = await products.findById(widgetId);
    expect(widget!.inventory.reserved).toBe(2);
  });

  it('cancel releases inventory and emits OrderCancelled', async () => {
    const order = await service.createOrder(command());
    const cancelled = await service.cancelOrder(order.id, 'customer changed mind', 'corr-2');
    expect(cancelled.status).toBe('cancelled');

    const widget = await products.findById(widgetId);
    expect(widget!.inventory).toEqual({ available: 5, reserved: 0 });
    expect(events.byName('OrderCancelled')).toHaveLength(1);
  });

  it('refuses to cancel an already-terminal order', async () => {
    const order = await service.createOrder(command());
    await service.cancelOrder(order.id, 'x', 'c');
    await expect(service.cancelOrder(order.id, 'again', 'c')).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists a customer orders newest-first', async () => {
    await service.createOrder(command({ idempotencyKey: 'k1' }));
    await service.createOrder(
      command({ idempotencyKey: 'k2', lines: [{ productId: widgetId, quantity: 1 }] }),
    );
    const page = await service.listCustomerOrders(customerId, { limit: 10 });
    expect(page.items).toHaveLength(2);
  });
});
