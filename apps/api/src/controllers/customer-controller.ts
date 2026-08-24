import { parseOrThrow, schemas } from '@cloud-commerce/validation';

import { getCustomerService } from '../container';
import { created, ok } from '../http/response';
import { type HttpRequest } from '../http/types';
import { requireAuth } from '../middleware/auth';

/**
 * Customer registration. In Phase 5 this is largely replaced by Cognito
 * post-confirmation provisioning; for now an authenticated caller registers
 * their own customer record (idempotent by email) and it is linked to their
 * auth subject.
 */
export class CustomerController {
  async register(req: HttpRequest) {
    const principal = requireAuth(req);
    const body = parseOrThrow(schemas.registerCustomerSchema, req.body);
    const customer = await getCustomerService().register({
      email: body.email,
      name: body.name,
      authSubject: principal.userId,
    });
    return created(toResponse(customer), `/customers/${customer.id}`);
  }

  async me(req: HttpRequest) {
    const principal = requireAuth(req);
    const customer = await getCustomerService().findByAuthSubject(principal.userId);
    return ok(customer ? toResponse(customer) : { registered: false });
  }
}

function toResponse(c: { id: string; email: string; name: string; createdAt: string }) {
  return { id: c.id, email: c.email, name: c.name, createdAt: c.createdAt };
}
