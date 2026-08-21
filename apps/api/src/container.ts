import { getConfig } from '@cloud-commerce/config';
import { DynamoProductRepository } from '@cloud-commerce/database';
import { CatalogService, type ProductRepository } from '@cloud-commerce/domain';

/**
 * Composition root. Wires application services to their adapters based on
 * config, once per warm container. Tests override the ports via the
 * `__set*` seams instead of standing up AWS.
 */

let productRepository: ProductRepository | undefined;
let catalogService: CatalogService | undefined;

export function getProductRepository(): ProductRepository {
  if (!productRepository) {
    productRepository = new DynamoProductRepository({
      tableName: getConfig().dynamodb.catalogTableName,
    });
  }
  return productRepository;
}

export function getCatalogService(): CatalogService {
  if (!catalogService) {
    catalogService = new CatalogService(getProductRepository());
  }
  return catalogService;
}

/** Test seam — inject fakes and reset between suites. */
export function __setContainer(overrides: {
  productRepository?: ProductRepository;
  catalogService?: CatalogService;
}): void {
  if (overrides.productRepository) productRepository = overrides.productRepository;
  if (overrides.catalogService) catalogService = overrides.catalogService;
}

export function __resetContainer(): void {
  productRepository = undefined;
  catalogService = undefined;
}
