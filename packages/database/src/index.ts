/**
 * Data-access layer. Repository implementations of the domain ports.
 * Added per build phase:
 *   - dynamo/client, secrets       (Phase 1)
 *   - dynamo product repository     (Phase 2)
 *   - dynamo idempotency store      (Phase 4)
 *   - postgres pool + repositories  (Phase 3)
 */
export { getDocumentClient, resetDocumentClient } from './dynamo/client';
export { getSecretString, getSecretJson, resetSecretsCache } from './secrets';
export {
  DynamoProductRepository,
  type DynamoProductRepositoryOptions,
} from './dynamo/product-repository';
export * as productKeys from './dynamo/product-keys';
