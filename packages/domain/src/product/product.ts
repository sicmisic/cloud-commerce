import { ValidationError } from '../shared/errors';
import { newId } from '../shared/ids';
import { type Money, money } from '../shared/money';

export const PRODUCT_STATUSES = ['active', 'inactive', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface InventoryLevel {
  /** Units on hand and sellable. */
  readonly available: number;
  /** Units held by in-flight orders, not yet shipped. */
  readonly reserved: number;
}

export interface Product {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly status: ProductStatus;
  readonly price: Money;
  readonly inventory: InventoryLevel;
  readonly imageKeys: string[];
  /**
   * Monotonic counter bumped on every write. Used for optimistic-concurrency
   * checks and as an audit signal; not exposed to clients as mutable.
   */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description: string;
  category: string;
  price: Money;
  initialStock: number;
  status?: ProductStatus;
  imageKeys?: string[];
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  category?: string;
  price?: Money;
  status?: ProductStatus;
  imageKeys?: string[];
}

const now = () => new Date().toISOString();

/** Construct a new product aggregate. Pure — no persistence. */
export function createProduct(input: CreateProductInput): Product {
  if (input.initialStock < 0 || !Number.isInteger(input.initialStock)) {
    throw new ValidationError('initialStock must be a non-negative integer', {
      initialStock: input.initialStock,
    });
  }
  if (input.price.amount <= 0) {
    throw new ValidationError('price must be greater than zero', { price: input.price });
  }
  const timestamp = now();
  return {
    id: newId('product'),
    sku: input.sku.toUpperCase(),
    name: input.name.trim(),
    description: input.description.trim(),
    category: input.category.trim().toLowerCase(),
    status: input.status ?? 'active',
    price: money(input.price.amount, input.price.currency),
    inventory: { available: input.initialStock, reserved: 0 },
    imageKeys: input.imageKeys ?? [],
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Apply a partial update, returning a new aggregate with a bumped version. */
export function applyUpdate(product: Product, patch: UpdateProductInput): Product {
  if (product.status === 'archived') {
    throw new ValidationError('an archived product cannot be modified', { id: product.id });
  }
  if (patch.price && patch.price.amount <= 0) {
    throw new ValidationError('price must be greater than zero', { price: patch.price });
  }
  return {
    ...product,
    name: patch.name?.trim() ?? product.name,
    description: patch.description?.trim() ?? product.description,
    category: patch.category?.trim().toLowerCase() ?? product.category,
    price: patch.price ? money(patch.price.amount, patch.price.currency) : product.price,
    status: patch.status ?? product.status,
    imageKeys: patch.imageKeys ?? product.imageKeys,
    version: product.version + 1,
    updatedAt: now(),
  };
}

export function isSellable(product: Product): boolean {
  return product.status === 'active' && product.inventory.available > 0;
}
