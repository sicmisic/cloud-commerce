import { HealthController } from '../controllers/health-controller';
import { type Router } from '../http/router';

const controller = new HealthController();

/** Public liveness/readiness routes. No auth. */
export function registerHealthRoutes(router: Router): void {
  router.get('/health', (req) => controller.live(req));
  router.get('/health/ready', (req) => controller.ready(req));
  // Root returns liveness too, so a bare curl of the API URL is useful.
  router.get('/', (req) => controller.live(req));
}
