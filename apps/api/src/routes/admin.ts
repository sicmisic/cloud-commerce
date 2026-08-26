import { AdminController } from '../controllers/admin-controller';
import { type Router } from '../http/router';

const admin = new AdminController();

/** Operations endpoints (Phase 4). OPERATIONS role required. */
export function registerAdminRoutes(router: Router): void {
  router.get('/admin/failed-events', (req) => admin.listFailedEvents(req));
  router.post('/admin/failed-events/:id/retry', (req) => admin.retryFailedEvents(req));
  router.get('/admin/failed-events/:id/retry-status', (req) => admin.retryStatus(req));
}
