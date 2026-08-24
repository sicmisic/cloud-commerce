/**
 * Data-access layer. Repository implementations of the domain ports.
 *   - dynamo/client, secrets       (Phase 1)
 *   - dynamo product repository     (Phase 2)
 *   - postgres pool + repositories  (Phase 3)
 *   - dynamo idempotency store      (Phase 4)
 */
export { getDocumentClient, resetDocumentClient } from './dynamo/client';
export { getSecretString, getSecretJson, resetSecretsCache } from './secrets';
export {
  DynamoProductRepository,
  type DynamoProductRepositoryOptions,
} from './dynamo/product-repository';
export * as productKeys from './dynamo/product-keys';

export { getPool, withTransaction, closePool } from './postgres/pool';
export { PostgresCustomerRepository } from './postgres/customer-repository';
export { PostgresOrderRepository } from './postgres/order-repository';
export { type Queryable } from './postgres/types';
