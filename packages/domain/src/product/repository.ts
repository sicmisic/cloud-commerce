import { type Page, type PageRequest } from '../shared/pagination';

import { type Product, type ProductStatus } from './product';

/** Filters accepted from the API before the limit is normalised. */
export interface ListProductsInput {
  readonly limit?: number;
  readonly cursor?: string;
  readonly category?: string;
  readonly status?: ProductStatus;
}

/** What the repository receives — limit is always resolved by the service. */
export interface ListProductsQuery extends PageRequest {
  readonly category?: string;
  readonly status?: ProductStatus;
}

/**
 * Persistence port for the catalog. Implemented by
 * `DynamoProductRepository` (production) and `InMemoryProductRepository`
 * (tests). Every method maps to a documented access pattern
 * (docs/database.md §DynamoDB catalog).
 */
export interface ProductRepository {
  /** Pattern 1 — get by id. */
  findById(id: string): Promise<Product | null>;

  /** Pattern 3 — get by SKU (unique). */
  findBySku(sku: string): Promise<Product | null>;

  /** Patterns 2 & 4 — list by category and/or status, paginated. */
  list(query: ListProductsQuery): Promise<Page<Product>>;

  /** Insert a new product. Rejects if the id or SKU already exists. */
  create(product: Product): Promise<void>;

  /**
   * Overwrite an existing product, asserting the stored `version` matches
   * `expectedVersion` (optimistic concurrency). Throws `ConflictError` on
   * mismatch.
   */
  update(product: Product, expectedVersion: number): Promise<void>;

  /**
   * Pattern 5 — atomically move `qty` units from `available` to `reserved`
   * using a conditional write (`available >= :qty`). Throws
   * `InsufficientInventoryError` when the condition fails.
   *
   * The condition is what prevents overselling: two concurrent reservations
   * for the last unit cannot both pass the `available >= :qty` check because
   * DynamoDB serialises the conditional updates on the item.
   */
  reserveInventory(productId: string, qty: number): Promise<Product>;

  /** Move `qty` units from `reserved` back to `available` (order cancelled). */
  releaseInventory(productId: string, qty: number): Promise<Product>;

  /** Adjust absolute on-hand stock (restock / shrinkage correction). */
  adjustAvailable(productId: string, delta: number): Promise<Product>;
}
