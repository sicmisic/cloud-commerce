import { ProductController } from '../controllers/product-controller';
import { type Router } from '../http/router';

const controller = new ProductController();

/**
 * Catalog routes. Reads are public; writes are guarded in the controller by the
 * `catalog:write` permission.
 */
export function registerProductRoutes(router: Router): void {
  router.get('/products', (req) => controller.list(req));
  router.get('/products/by-sku/:sku', (req) => controller.getBySku(req));
  router.get('/products/:id', (req) => controller.getById(req));
  router.post('/products', (req) => controller.create(req));
  router.patch('/products/:id', (req) => controller.update(req));
  router.delete('/products/:id', (req) => controller.archive(req));
  router.post('/products/:id/inventory/adjust', (req) => controller.adjustStock(req));
}
