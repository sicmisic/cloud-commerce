import { Router } from '../http/router';

import { registerHealthRoutes } from './health';

/**
 * Build the full route table. Route modules are added per phase:
 *   - health   (Phase 1)
 *   - products (Phase 2)
 *   - orders   (Phase 3)
 *   - admin    (Phase 4)
 */
export function buildRouter(): Router {
  const router = new Router();
  registerHealthRoutes(router);
  return router;
}
