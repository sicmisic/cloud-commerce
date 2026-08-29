import { type HttpRequest, type HttpResponse } from './http/types';
import {
  compose,
  withAudit,
  withAuth,
  withCors,
  withErrorHandler,
  withRateLimit,
  withRequestContext,
} from './middleware';
import { buildRouter } from './routes';

const router = buildRouter();

/**
 * Middleware order (outermost first):
 *   1. request-context  — ALS scope, logging, LambdaDuration/Errors metrics
 *   2. cors             — headers on every response, short-circuits OPTIONS
 *   3. error-handler    — maps thrown errors -> problem+json
 *   4. auth             — attaches req.principal when a credential is present
 *   5. rate-limit       — in-process guard, keyed by principal/IP
 *   6. audit            — one structured line per state-changing request
 * then the matched route handler.
 */
const pipeline = compose(
  [withRequestContext, withCors, withErrorHandler, withAuth, withRateLimit, withAudit],
  async (req: HttpRequest) => {
    const { handler } = router.match(req);
    return handler(req);
  },
);

export function dispatch(req: HttpRequest): Promise<HttpResponse> {
  return Promise.resolve(pipeline(req));
}

export { router };
