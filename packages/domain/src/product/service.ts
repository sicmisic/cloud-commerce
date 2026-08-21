import { ConflictError, NotFoundError, ValidationError } from '../shared/errors';
import { type Money } from '../shared/money';
import { type Page, normalizeLimit } from '../shared/pagination';

import {
  type CreateProductInput,
  type Product,
  type ProductStatus,
  type UpdateProductInput,
  applyUpdate,
  createProduct,
} from './product';
import { type ListProductsInput, type ProductRepository } from './repository';

/**
 * Application service for the catalog use cases. Depends only on the
 * {@link ProductRepository} port — unit-tested with an in-memory repo, no AWS.
 */
export class CatalogService {
  constructor(private readonly products: ProductRepository) {}

  async getById(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  async getBySku(sku: string): Promise<Product> {
    const product = await this.products.findBySku(sku.toUpperCase());
    if (!product) throw new NotFoundError('Product', `sku:${sku}`);
    return product;
  }

  async list(query: ListProductsInput): Promise<Page<Product>> {
    return this.products.list({ ...query, limit: normalizeLimit(query.limit) });
  }

  async create(input: CreateProductInput): Promise<Product> {
    const existing = await this.products.findBySku(input.sku.toUpperCase());
    if (existing) {
      throw new ConflictError(`A product with SKU '${input.sku}' already exists`, {
        sku: input.sku,
        existingId: existing.id,
      });
    }
    const product = createProduct(input);
    await this.products.create(product);
    return product;
  }

  async update(id: string, patch: UpdateProductInput): Promise<Product> {
    const current = await this.getById(id);
    const updated = applyUpdate(current, patch);
    await this.products.update(updated, current.version);
    return updated;
  }

  async archive(id: string): Promise<Product> {
    const current = await this.getById(id);
    if (current.status === 'archived') return current;
    if (current.inventory.reserved > 0) {
      throw new ConflictError('Cannot archive a product with active reservations', {
        id,
        reserved: current.inventory.reserved,
      });
    }
    const archived = applyUpdate(current, { status: 'archived' as ProductStatus });
    await this.products.update(archived, current.version);
    return archived;
  }

  async setPrice(id: string, price: Money): Promise<Product> {
    return this.update(id, { price });
  }

  /** Restock / correct on-hand quantity. Positive to add, negative to remove. */
  async adjustStock(id: string, delta: number): Promise<Product> {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new ValidationError('stock adjustment must be a non-zero integer', { delta });
    }
    await this.getById(id); // 404 if missing
    return this.products.adjustAvailable(id, delta);
  }

  /**
   * Reserve stock for an order line (used by Phase 3 order creation).
   * Surfaces {@link InsufficientInventoryError} unchanged.
   */
  async reserve(id: string, qty: number): Promise<Product> {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ValidationError('reservation quantity must be a positive integer', { qty });
    }
    // Throws InsufficientInventoryError when the conditional write fails.
    return this.products.reserveInventory(id, qty);
  }

  async release(id: string, qty: number): Promise<Product> {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ValidationError('release quantity must be a positive integer', { qty });
    }
    return this.products.releaseInventory(id, qty);
  }
}
