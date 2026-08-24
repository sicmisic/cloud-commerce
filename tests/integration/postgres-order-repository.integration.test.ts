import {
  PostgresCustomerRepository,
  PostgresOrderRepository,
  closePool,
} from '@cloud-commerce/database';
import {
  ConflictError,
  createCustomer,
  createOrder,
  money,
  newPayment,
  newShipment,
} from '@cloud-commerce/domain';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  databaseUrl,
  ensureMigrated,
  makePool,
  postgresAvailable,
  truncateAll,
} from '../helpers/postgres';

const describeIf = postgresAvailable ? describe : describe.skip;

const address = {
  name: 'Katherine Johnson',
  line1: '1 Orbit Rd',
  city: 'Hampton',
  region: 'VA',
  postalCode: '23666',
  country: 'US',
};

describeIf('integration: PostgresOrderRepository', () => {
  let pool: Pool;
  const customerRepo = new PostgresCustomerRepository();
  const orderRepo = new PostgresOrderRepository();

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    ensureMigrated();
    pool = makePool();
  }, 60_000);

  beforeEach(() => truncateAll(pool));

  afterAll(async () => {
    await pool.end();
    await closePool();
  });

  async function seedCustomer() {
    const customer = createCustomer({ email: `k-${Date.now()}@example.com`, name: 'Katherine' });
    await customerRepo.create(customer);
    return customer;
  }

  function buildOrder(customerId: string, idempotencyKey?: string) {
    const order = createOrder({
      customerId,
      lines: [
        { productId: 'prod_1', sku: 'SKU-1', name: 'Widget', unitPrice: money(2000), quantity: 2 },
      ],
      shippingAddress: address,
      billingAddress: address,
      idempotencyKey,
    });
    return {
      order,
      payment: newPayment({ orderId: order.id, amount: order.total, provider: 'mock' }),
      shipment: newShipment({ orderId: order.id, address }),
    };
  }

  it('writes order + items + payment + shipment atomically and reads them back', async () => {
    const customer = await seedCustomer();
    const record = buildOrder(customer.id);
    await orderRepo.create(record);

    const view = await orderRepo.findById(record.order.id);
    expect(view).not.toBeNull();
    expect(view!.items).toHaveLength(1);
    expect(view!.items[0]!.lineTotal).toEqual(money(4000));
    expect(view!.payments).toHaveLength(1);
    expect(view!.shipments).toHaveLength(1);
    expect(view!.total).toEqual(record.order.total);
  });

  it('enforces the idempotency-key unique index', async () => {
    const customer = await seedCustomer();
    await orderRepo.create(buildOrder(customer.id, 'dup-key'));
    await expect(orderRepo.create(buildOrder(customer.id, 'dup-key'))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('updateStatus is guarded by the expected status set', async () => {
    const customer = await seedCustomer();
    const record = buildOrder(customer.id);
    await orderRepo.create(record);

    await orderRepo.updateStatus(record.order.id, 'confirmed', ['pending']);
    await expect(
      orderRepo.updateStatus(record.order.id, 'confirmed', ['pending']),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists a customer orders newest-first with pagination', async () => {
    const customer = await seedCustomer();
    for (let i = 0; i < 3; i++) await orderRepo.create(buildOrder(customer.id));
    const page1 = await orderRepo.listByCustomer(customer.id, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await orderRepo.listByCustomer(customer.id, {
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(1);
  });

  it('rejects an order whose customer FK does not exist', async () => {
    await expect(orderRepo.create(buildOrder('cust_missing'))).rejects.toThrow();
  });
});
