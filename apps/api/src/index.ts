export { handler } from './handlers/api';
export { dispatch } from './app';
export { buildRouter } from './routes';
export { withAudit } from './middleware/audit';
export type { HttpRequest, HttpResponse, Middleware, RouteHandler } from './http/types';

// Test seams — compose the container with in-memory ports.
export { __setContainer, __resetContainer, __installInMemoryEventPublisher } from './container';
export { setTokenVerifier } from './middleware/auth';
export { resetRateLimiter } from './middleware/rate-limit';
