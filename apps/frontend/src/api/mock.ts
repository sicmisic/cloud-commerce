import { ApiError, type Address, type Order, type Page, type Product } from './types';

/**
 * In-memory backend for local development and demos. Mirrors the real API's
 * behaviour closely enough to exercise every UI state (loading, empty, error,
 * out-of-stock, order lifecycle).
 */

const money = (amount: number) => ({
  amount,
  currency: 'USD',
  display: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    amount / 100,
  ),
});

const now = () => new Date().toISOString();

function product(over: Partial<Product> & Pick<Product, 'id' | 'name' | 'category'>): Product {
  return {
    sku: over.id.toUpperCase(),
    description: 'A well-made thing, responsibly sourced and built to last.',
    status: 'active',
    price: money(over.price?.amount ?? 4999),
    inventory: over.inventory ?? { available: 12, reserved: 0 },
    imageKeys: [],
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    ...over,
  } as Product;
}

const catalog: Product[] = [
  product({
    id: 'prod_desk_lamp',
    name: 'Studio Desk Lamp',
    category: 'lighting',
    price: money(8900),
  }),
  product({
    id: 'prod_wool_throw',
    name: 'Merino Wool Throw',
    category: 'home',
    price: money(12900),
  }),
  product({
    id: 'prod_ceramic_mug',
    name: 'Stoneware Mug (Set of 4)',
    category: 'kitchen',
    price: money(4200),
  }),
  product({
    id: 'prod_notebook',
    name: 'Dot-Grid Notebook',
    category: 'stationery',
    price: money(1800),
  }),
  product({
    id: 'prod_headphones',
    name: 'Over-Ear Headphones',
    category: 'audio',
    price: money(21900),
    inventory: { available: 1, reserved: 0 },
  }),
  product({
    id: 'prod_water_bottle',
    name: 'Insulated Water Bottle',
    category: 'kitchen',
    price: money(3500),
    inventory: { available: 0, reserved: 4 },
  }),
];

const orders = new Map<string, Order>();
const idempotency = new Map<string, string>();

const delay = <T>(value: T, ms = 350): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export const mockApi = {
  async listProducts(query: {
    category?: string;
    limit?: number;
    cursor?: string;
  }): Promise<Page<Product>> {
    let items = catalog.filter((p) => p.status === 'active');
    if (query.category) items = items.filter((p) => p.category === query.category);
    return delay({ items, nextCursor: null });
  },

  async getProduct(id: string): Promise<Product> {
    const found = catalog.find((p) => p.id === id);
    if (!found) {
      throw new ApiError(
        { type: 'not-found', title: `Product '${id}' was not found`, status: 404 },
        404,
      );
    }
    return delay(found);
  },

  async createOrder(
    input: { lines: { productId: string; quantity: number }[]; shippingAddress: Address },
    idempotencyKey: string,
  ): Promise<Order> {
    const replay = idempotency.get(idempotencyKey);
    if (replay) return delay(orders.get(replay)!);

    const items = input.lines.map((line, i) => {
      const p = catalog.find((x) => x.id === line.productId);
      if (!p) throw new ApiError({ type: 'not-found', title: 'unknown product', status: 409 }, 409);
      if (p.inventory.available < line.quantity) {
        throw new ApiError(
          {
            type: 'insufficient-inventory',
            title: `Only ${p.inventory.available} of "${p.name}" left`,
            status: 409,
          },
          409,
        );
      }
      p.inventory = {
        available: p.inventory.available - line.quantity,
        reserved: p.inventory.reserved + line.quantity,
      };
      return {
        id: `oit_${i}`,
        productId: p.id,
        sku: p.sku,
        name: p.name,
        unitPrice: p.price.amount,
        quantity: line.quantity,
        lineTotal: p.price.amount * line.quantity,
      };
    });

    const subtotal = items.reduce((n, i) => n + i.lineTotal, 0);
    const tax = Math.round(subtotal * 0.08);
    const shippingFee = subtotal >= 7500 ? 0 : 899;
    const total = subtotal + tax + shippingFee;
    const id = `ord_${Math.random().toString(36).slice(2, 10)}`;
    const order: Order = {
      id,
      customerId: 'cust_demo',
      status: 'pending',
      currency: 'USD',
      items,
      subtotal,
      tax,
      shippingFee,
      total,
      totalDisplay: money(total).display,
      payments: [{ id: 'pay_1', status: 'pending', amount: total }],
      shipments: [{ id: 'shp_1', status: 'requested', trackingNumber: null }],
      createdAt: now(),
      updatedAt: now(),
    };
    orders.set(id, order);
    idempotency.set(idempotencyKey, id);

    // Simulate the async pipeline advancing the order over the next few seconds.
    advanceOrder(id);
    return delay(order);
  },

  async getOrder(id: string): Promise<Order> {
    const found = orders.get(id);
    if (!found)
      throw new ApiError({ type: 'not-found', title: 'order not found', status: 404 }, 404);
    return delay(found, 150);
  },
};

function advanceOrder(id: string): void {
  const step = (status: Order['status'], patch: Partial<Order>, ms: number) =>
    setTimeout(() => {
      const o = orders.get(id);
      if (!o || o.status === 'cancelled') return;
      orders.set(id, { ...o, status, updatedAt: now(), ...patch });
    }, ms);

  step('confirmed', { payments: [{ id: 'pay_1', status: 'captured', amount: 0 }] }, 2500);
  step(
    'processing',
    { shipments: [{ id: 'shp_1', status: 'dispatched', trackingNumber: 'MX000000123456' }] },
    5000,
  );
}
