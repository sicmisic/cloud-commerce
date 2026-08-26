import { Router } from '../http/router';

import { registerAdminRoutes } from './admin';
import { registerHealthRoutes } from './health';
import { registerOrderRoutes } from './orders';
import { registerProductRoutes } from './products';

/**
 * Build the full route table. Route modules are added per phase:
 *   - health   (Phase 1)
 *   - products (Phase 2)
 *   - orders + customers (Phase 3)
 *   - admin    (Phase 4)
 */
export function buildRouter(): Router {
  const router = new Router();
  registerHealthRoutes(router);
  registerProductRoutes(router);
  registerOrderRoutes(router);
  registerAdminRoutes(router);
  return router;
}
