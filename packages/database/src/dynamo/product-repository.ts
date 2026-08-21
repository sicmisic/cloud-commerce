import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  ConflictError,
  DependencyFailureError,
  InsufficientInventoryError,
  NotFoundError,
  decodeCursor,
  encodeCursor,
  type Page,
  type Product,
  type ListProductsQuery,
  type ProductRepository,
} from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

import { getDocumentClient } from './client';
import {
  CATEGORY_GSI_PK,
  PRODUCT_PK,
  SKU_GSI_PK,
  STATUS_GSI_PK,
  fromItem,
  toItem,
} from './product-keys';

const log = logger('DynamoProductRepository');

export interface DynamoProductRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

/**
 * DynamoDB implementation of {@link ProductRepository}. Every read is a
 * `GetItem` or `Query` against a documented access pattern — no `Scan`.
 *
 * The `available >= :qty` condition on {@link reserveInventory} is the
 * oversell guard: DynamoDB serialises conditional updates on a single item, so
 * two concurrent reservations for the last unit cannot both pass the check —
 * the loser gets `InsufficientInventoryError`, never a negative balance.
 */
export class DynamoProductRepository implements ProductRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(options: DynamoProductRepositoryOptions) {
    this.table = options.tableName;
    this.client = options.client ?? getDocumentClient();
  }

  // --- Pattern 1: get by id --------------------------------------------
  async findById(id: string): Promise<Product | null> {
    const result = await this.run('findById', () =>
      this.client.send(
        new GetCommand({ TableName: this.table, Key: { PK: PRODUCT_PK(id), SK: PRODUCT_PK(id) } }),
      ),
    );
    return result.Item ? fromItem(result.Item) : null;
  }

  // --- Pattern 3: find by SKU (GSI2) -----------------------------------
  async findBySku(sku: string): Promise<Product | null> {
    const result = await this.run('findBySku', () =>
      this.client.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: { ':pk': SKU_GSI_PK(sku) },
          Limit: 1,
        }),
      ),
    );
    const item = result.Items?.[0];
    return item ? fromItem(item) : null;
  }

  // --- Patterns 2 & 4: list by category (GSI1) / by status (GSI3) ------
  async list(query: ListProductsQuery): Promise<Page<Product>> {
    const params = query.category
      ? {
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          values: { ':pk': CATEGORY_GSI_PK(query.category) },
        }
      : {
          IndexName: 'GSI3',
          KeyConditionExpression: 'GSI3PK = :pk',
          values: { ':pk': STATUS_GSI_PK(query.status ?? 'active') },
        };

    // A category partition is small; narrowing by status is a cheap filter.
    const withStatusFilter = Boolean(query.category && query.status);

    const result = await this.run('list', () =>
      this.client.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: params.IndexName,
          KeyConditionExpression: params.KeyConditionExpression,
          ...(withStatusFilter
            ? {
                FilterExpression: '#s = :status',
                ExpressionAttributeNames: { '#s': 'status' },
                ExpressionAttributeValues: { ...params.values, ':status': query.status },
              }
            : { ExpressionAttributeValues: params.values }),
          Limit: query.limit,
          ExclusiveStartKey: decodeCursor(query.cursor),
        }),
      ),
    );

    return {
      items: (result.Items ?? []).map(fromItem),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    };
  }

  // --- create ---------------------------------------------------------
  async create(product: Product): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: toItem(product),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (err) {
      if (isConditionFailed(err)) throw new ConflictError(`Product '${product.id}' already exists`);
      throw this.dependencyError(err, 'create');
    }
  }

  // --- update (optimistic concurrency) ------------------------------
  async update(product: Product, expectedVersion: number): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: toItem(product),
          ConditionExpression: 'attribute_exists(PK) AND version = :expected',
          ExpressionAttributeValues: { ':expected': expectedVersion },
        }),
      );
    } catch (err) {
      if (isConditionFailed(err)) {
        throw new ConflictError('Product was modified concurrently', {
          id: product.id,
          expectedVersion,
        });
      }
      throw this.dependencyError(err, 'update');
    }
  }

  // --- Pattern 5: reserve inventory (conditional update) ------------
  async reserveInventory(productId: string, qty: number): Promise<Product> {
    try {
      return await this.applyInventoryDelta(productId, {
        UpdateExpression:
          'SET available = available - :q, reserved = reserved + :q, version = version + :one, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK) AND available >= :q',
        values: { ':q': qty },
      });
    } catch (err) {
      if (isConditionFailed(err)) {
        const current = await this.findById(productId);
        if (!current) throw new NotFoundError('Product', productId);
        throw new InsufficientInventoryError(productId, qty, current.inventory.available);
      }
      throw this.dependencyError(err, 'reserveInventory');
    }
  }

  async releaseInventory(productId: string, qty: number): Promise<Product> {
    const current = await this.findById(productId);
    if (!current) throw new NotFoundError('Product', productId);
    const releasable = Math.min(qty, current.inventory.reserved);
    if (releasable === 0) return current;
    try {
      return await this.applyInventoryDelta(productId, {
        UpdateExpression:
          'SET available = available + :r, reserved = reserved - :r, version = version + :one, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK) AND reserved >= :r',
        values: { ':r': releasable },
      });
    } catch (err) {
      if (isConditionFailed(err)) return this.getOrThrow(productId);
      throw this.dependencyError(err, 'releaseInventory');
    }
  }

  async adjustAvailable(productId: string, delta: number): Promise<Product> {
    try {
      return await this.applyInventoryDelta(productId, {
        UpdateExpression:
          'SET available = available + :d, version = version + :one, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK) AND available >= :floor',
        values: { ':d': delta, ':floor': delta < 0 ? -delta : 0 },
      });
    } catch (err) {
      if (isConditionFailed(err)) {
        const current = await this.findById(productId);
        if (!current) throw new NotFoundError('Product', productId);
        throw new InsufficientInventoryError(productId, -delta, current.inventory.available);
      }
      throw this.dependencyError(err, 'adjustAvailable');
    }
  }

  /** Test / cleanup only — never a request path. */
  async hardDelete(id: string): Promise<void> {
    await this.run('hardDelete', () =>
      this.client.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { PK: PRODUCT_PK(id), SK: PRODUCT_PK(id) },
        }),
      ),
    );
  }

  private async applyInventoryDelta(
    productId: string,
    spec: {
      UpdateExpression: string;
      ConditionExpression: string;
      values: Record<string, number>;
    },
  ): Promise<Product> {
    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: PRODUCT_PK(productId), SK: PRODUCT_PK(productId) },
        UpdateExpression: spec.UpdateExpression,
        ConditionExpression: spec.ConditionExpression,
        ExpressionAttributeValues: {
          ...spec.values,
          ':one': 1,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    if (!result.Attributes) throw new NotFoundError('Product', productId);
    // Inventory deltas never touch name/category/status, so the derived GSI
    // sort keys stay valid without a rewrite.
    return fromItem(result.Attributes);
  }

  private async getOrThrow(id: string): Promise<Product> {
    const product = await this.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  private async run<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.dependencyError(err, op);
    }
  }

  private dependencyError(err: unknown, op: string): Error {
    if (
      err instanceof ConflictError ||
      err instanceof NotFoundError ||
      err instanceof InsufficientInventoryError
    ) {
      return err;
    }
    log.error({ err, op }, 'dynamodb operation failed');
    return new DependencyFailureError('dynamodb', err);
  }
}

function isConditionFailed(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'ConditionalCheckFailedException'
  );
}
