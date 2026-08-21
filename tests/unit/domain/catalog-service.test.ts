import {
  CatalogService,
  ConflictError,
  InMemoryProductRepository,
  InsufficientInventoryError,
  NotFoundError,
  createProduct,
  money,
} from '@cloud-commerce/domain';
import { beforeEach, describe, expect, it } from 'vitest';

describe('CatalogService', () => {
  let repo: InMemoryProductRepository;
  let service: CatalogService;

  beforeEach(() => {
    repo = new InMemoryProductRepository();
    service = new CatalogService(repo);
  });

  it('creates and reads back a product', async () => {
    const created = await service.create({
      sku: 'abc-1',
      name: 'Thing',
      description: 'a thing',
      category: 'Things',
      price: money(2500),
      initialStock: 3,
    });
    expect(await service.getById(created.id)).toEqual(created);
    expect((await service.getBySku('ABC-1')).id).toBe(created.id);
  });

  it('rejects a duplicate SKU', async () => {
    await service.create({
      sku: 'dup-1',
      name: 'A',
      description: 'a',
      category: 'c',
      price: money(100),
      initialStock: 1,
    });
    await expect(
      service.create({
        sku: 'DUP-1',
        name: 'B',
        description: 'b',
        category: 'c',
        price: money(100),
        initialStock: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('404s for a missing product', async () => {
    await expect(service.getById('prod_missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates with optimistic concurrency (version bump)', async () => {
    const p = await service.create({
      sku: 'v-1',
      name: 'V',
      description: 'v',
      category: 'c',
      price: money(100),
      initialStock: 1,
    });
    const updated = await service.update(p.id, { name: 'V2' });
    expect(updated.name).toBe('V2');
    expect(updated.version).toBe(p.version + 1);
  });

  it('will not archive a product with active reservations', async () => {
    const p = await service.create({
      sku: 'r-1',
      name: 'R',
      description: 'r',
      category: 'c',
      price: money(100),
      initialStock: 5,
    });
    await service.reserve(p.id, 2);
    await expect(service.archive(p.id)).rejects.toBeInstanceOf(ConflictError);
  });

  describe('inventory reservation', () => {
    it('moves units available -> reserved', async () => {
      const p = await service.create({
        sku: 'i-1',
        name: 'I',
        description: 'i',
        category: 'c',
        price: money(100),
        initialStock: 10,
      });
      const after = await service.reserve(p.id, 4);
      expect(after.inventory).toEqual({ available: 6, reserved: 4 });
    });

    it('rejects a reservation larger than available', async () => {
      const p = await service.create({
        sku: 'i-2',
        name: 'I2',
        description: 'i',
        category: 'c',
        price: money(100),
        initialStock: 2,
      });
      await expect(service.reserve(p.id, 3)).rejects.toBeInstanceOf(InsufficientInventoryError);
    });

    it('prevents overselling the last unit under concurrency', async () => {
      const p = await service.create({
        sku: 'last-1',
        name: 'Last',
        description: 'l',
        category: 'c',
        price: money(100),
        initialStock: 1,
      });
      // Fire two reservations "simultaneously"; exactly one must win.
      const results = await Promise.allSettled([
        service.reserve(p.id, 1),
        service.reserve(p.id, 1),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const final = await service.getById(p.id);
      expect(final.inventory).toEqual({ available: 0, reserved: 1 });
    });

    it('release returns units and is clamped at zero reserved', async () => {
      const p = await service.create({
        sku: 'rel-1',
        name: 'Rel',
        description: 'r',
        category: 'c',
        price: money(100),
        initialStock: 5,
      });
      await service.reserve(p.id, 3);
      const afterRelease = await service.release(p.id, 10); // over-release
      expect(afterRelease.inventory).toEqual({ available: 5, reserved: 0 });
    });
  });

  it('seeded list is paginated and filterable', async () => {
    const seed = [
      createProduct({
        sku: 's1',
        name: 'Alpha',
        description: 'd',
        category: 'a',
        price: money(1),
        initialStock: 1,
      }),
      createProduct({
        sku: 's2',
        name: 'Bravo',
        description: 'd',
        category: 'b',
        price: money(1),
        initialStock: 1,
      }),
      createProduct({
        sku: 's3',
        name: 'Charlie',
        description: 'd',
        category: 'a',
        price: money(1),
        initialStock: 1,
      }),
    ];
    repo = new InMemoryProductRepository(seed);
    service = new CatalogService(repo);

    const catA = await service.list({ category: 'a' });
    expect(catA.items.map((p) => p.name)).toEqual(['Alpha', 'Charlie']);

    const firstPage = await service.list({ limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await service.list({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.items).toHaveLength(1);
  });
});
