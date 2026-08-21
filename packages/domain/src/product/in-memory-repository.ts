import { ConflictError, InsufficientInventoryError, NotFoundError } from '../shared/errors';
import { type Page, encodeCursor, decodeCursor, normalizeLimit } from '../shared/pagination';

import { type Product } from './product';
import { type ListProductsQuery, type ProductRepository } from './repository';

/**
 * Reference in-memory implementation of {@link ProductRepository}. Backs unit
 * and E2E tests and mirrors the DynamoDB implementation's semantics —
 * especially the conditional inventory reservation.
 */
export class InMemoryProductRepository implements ProductRepository {
  private readonly byId = new Map<string, Product>();

  constructor(seed: Product[] = []) {
    for (const p of seed) this.byId.set(p.id, p);
  }

  async findById(id: string): Promise<Product | null> {
    return this.byId.get(id) ?? null;
  }

  async findBySku(sku: string): Promise<Product | null> {
    for (const p of this.byId.values()) {
      if (p.sku === sku) return p;
    }
    return null;
  }

  async list(query: ListProductsQuery): Promise<Page<Product>> {
    const limit = normalizeLimit(query.limit);
    let items = [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (query.category) items = items.filter((p) => p.category === query.category);
    if (query.status) items = items.filter((p) => p.status === query.status);

    const offset = (decodeCursor(query.cursor)?.offset as number | undefined) ?? 0;
    const pageItems = items.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return {
      items: pageItems,
      nextCursor: nextOffset < items.length ? encodeCursor({ offset: nextOffset }) : undefined,
    };
  }

  async create(product: Product): Promise<void> {
    if (this.byId.has(product.id)) {
      throw new ConflictError(`Product '${product.id}' already exists`);
    }
    if (await this.findBySku(product.sku)) {
      throw new ConflictError(`SKU '${product.sku}' already exists`);
    }
    this.byId.set(product.id, product);
  }

  async update(product: Product, expectedVersion: number): Promise<void> {
    const current = this.byId.get(product.id);
    if (!current) throw new NotFoundError('Product', product.id);
    if (current.version !== expectedVersion) {
      throw new ConflictError('Product was modified concurrently', {
        id: product.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    this.byId.set(product.id, product);
  }

  async reserveInventory(productId: string, qty: number): Promise<Product> {
    const current = this.mustGet(productId);
    // Mirrors the DynamoDB `ConditionExpression: available >= :qty`.
    if (current.inventory.available < qty) {
      throw new InsufficientInventoryError(productId, qty, current.inventory.available);
    }
    return this.mutate(current, {
      available: current.inventory.available - qty,
      reserved: current.inventory.reserved + qty,
    });
  }

  async releaseInventory(productId: string, qty: number): Promise<Product> {
    const current = this.mustGet(productId);
    const releasable = Math.min(qty, current.inventory.reserved);
    return this.mutate(current, {
      available: current.inventory.available + releasable,
      reserved: current.inventory.reserved - releasable,
    });
  }

  async adjustAvailable(productId: string, delta: number): Promise<Product> {
    const current = this.mustGet(productId);
    const next = current.inventory.available + delta;
    if (next < 0) {
      throw new InsufficientInventoryError(productId, -delta, current.inventory.available);
    }
    return this.mutate(current, { available: next, reserved: current.inventory.reserved });
  }

  /** Test helper. */
  all(): Product[] {
    return [...this.byId.values()];
  }

  private mustGet(id: string): Product {
    const p = this.byId.get(id);
    if (!p) throw new NotFoundError('Product', id);
    return p;
  }

  private mutate(current: Product, inventory: Product['inventory']): Product {
    const next: Product = {
      ...current,
      inventory,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.byId.set(next.id, next);
    return next;
  }
}
