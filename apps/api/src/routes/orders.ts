import { CustomerController } from '../controllers/customer-controller';
import { OrderController } from '../controllers/order-controller';
import { type Router } from '../http/router';

const orders = new OrderController();
const customers = new CustomerController();

/** Order + customer routes (Phase 3). All require authentication. */
export function registerOrderRoutes(router: Router): void {
  router.post('/customers', (req) => customers.register(req));
  router.get('/customers/me', (req) => customers.me(req));
  router.get('/customers/:id/orders', (req) => orders.listForCustomer(req));

  router.post('/orders', (req) => orders.create(req));
  router.get('/orders/:id', (req) => orders.getById(req));
  router.post('/orders/:id/cancel', (req) => orders.cancel(req));
}
