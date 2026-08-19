import { type Middleware, type RouteHandler } from '../http/types';

/**
 * Compose middlewares around a handler. The first entry is the outermost
 * wrapper (runs first on the way in, last on the way out).
 */
export function compose(middlewares: Middleware[], handler: RouteHandler): RouteHandler {
  return middlewares.reduceRight<RouteHandler>((next, mw) => mw(next), handler);
}
