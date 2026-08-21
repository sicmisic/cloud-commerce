import { DynamoProductRepository } from '@cloud-commerce/database';
import {
  createProduct,
  money,
  InsufficientInventoryError,
  ConflictError,
} from '@cloud-commerce/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCatalogTable,
  dropTable,
  dynamoAvailable,
  makeDocClient,
  makeRawClient,
  uniqueTableName,
} from '../helpers/dynamo';

const describeIf = dynamoAvailable ? describe : describe.skip;

describeIf('integration: DynamoProductRepository (DynamoDB Local)', () => {
  const tableName = uniqueTableName();
  const raw = makeRawClient();
  let repo: DynamoProductRepository;

  beforeAll(async () => {
    await createCatalogTable(raw, tableName);
    repo = new DynamoProductRepository({ tableName, client: makeDocClient() });
  }, 30_000);

  afterAll(async () => {
    await dropTable(raw, tableName);
    raw.destroy();
  });

  const sample = (over: Partial<Parameters<typeof createProduct>[0]> = {}) =>
    createProduct({
      sku: over.sku ?? `sku-${Math.random().toString(36).slice(2, 8)}`,
      name: over.name ?? 'Widget',
      description: 'd',
      category: over.category ?? 'gadgets',
      price: over.price ?? money(1500),
      initialStock: over.initialStock ?? 10,
    });

  it('create + findById round-trips every field', async () => {
    const product = sample({ name: 'Round Trip', category: 'toys' });
    await repo.create(product);
    const fetched = await repo.findById(product.id);
    expect(fetched).toEqual(product);
  });

  it('rejects a duplicate id', async () => {
    const product = sample();
    await repo.create(product);
    await expect(repo.create(product)).rejects.toBeInstanceOf(ConflictError);
  });

  it('findBySku uses GSI2', async () => {
    const product = sample({ sku: 'gsi2-lookup' });
    await repo.create(product);
    const found = await repo.findBySku('GSI2-LOOKUP');
    expect(found?.id).toBe(product.id);
  });

  it('list by category (GSI1) and by status (GSI3) with pagination', async () => {
    const cat = `cat-${Date.now()}`;
    for (const name of ['Apple', 'Banana', 'Cherry']) {
      await repo.create(sample({ name, category: cat }));
    }
    const page1 = await repo.list({ category: cat, limit: 2 });
    expect(page1.items.map((p) => p.name)).toEqual(['Apple', 'Banana']);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await repo.list({ category: cat, limit: 2, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(1);

    const active = await repo.list({ status: 'active', limit: 50 });
    expect(active.items.length).toBeGreaterThanOrEqual(3);
  });

  it('reserveInventory is a conditional write that prevents overselling', async () => {
    const product = sample({ initialStock: 1 });
    await repo.create(product);

    const results = await Promise.allSettled([
      repo.reserveInventory(product.id, 1),
      repo.reserveInventory(product.id, 1),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InsufficientInventoryError);

    const after = await repo.findById(product.id);
    expect(after?.inventory).toEqual({ available: 0, reserved: 1 });
  });

  it('release returns reserved units to available', async () => {
    const product = sample({ initialStock: 5 });
    await repo.create(product);
    await repo.reserveInventory(product.id, 3);
    const released = await repo.releaseInventory(product.id, 2);
    expect(released.inventory).toEqual({ available: 4, reserved: 1 });
  });

  it('update enforces the expected version', async () => {
    const product = sample();
    await repo.create(product);
    const bumped = { ...product, name: 'v2', version: product.version + 1 };
    await repo.update(bumped, product.version);
    await expect(repo.update({ ...bumped, name: 'v3' }, product.version)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
