import { requirePermission } from '@cloud-commerce/auth';
import { ValidationError } from '@cloud-commerce/domain';

import { getDlqAdmin } from '../container';
import { accepted, ok } from '../http/response';
import { type HttpRequest } from '../http/types';
import { requireAuth } from '../middleware/auth';

/**
 * Operations endpoints for the dead-letter queues (CLAUDE.md §6 — DLQ handling
 * is not "future work"). Requires the OPERATIONS role.
 */
export class AdminController {
  async listFailedEvents(req: HttpRequest) {
    requirePermission(requireAuth(req), 'admin:failed-events:read');
    const summaries = await getDlqAdmin().list();
    return ok({
      queues: summaries,
      totalFailed: summaries.reduce((n, s) => n + s.approximateMessages, 0),
    });
  }

  async retryFailedEvents(req: HttpRequest) {
    requirePermission(requireAuth(req), 'admin:failed-events:retry');
    const queue = req.params.id ?? '';
    if (!queue) throw new ValidationError('a DLQ name is required in the path');
    const result = await getDlqAdmin().retry(queue);
    return accepted({
      message: `redrive started for the ${queue} DLQ`,
      ...result,
    });
  }

  async retryStatus(req: HttpRequest) {
    requirePermission(requireAuth(req), 'admin:failed-events:read');
    const tasks = await getDlqAdmin().retryStatus(req.params.id ?? '');
    return ok({ tasks });
  }
}
