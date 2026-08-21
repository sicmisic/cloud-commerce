export { handler } from './handlers/api';
export { dispatch } from './app';
export { buildRouter } from './routes';
export type { HttpRequest, HttpResponse } from './http/types';

// Test seams — compose the container with in-memory ports.
export { __setContainer, __resetContainer } from './container';
export { setTokenVerifier } from './middleware/auth';
export { resetRateLimiter } from './middleware/rate-limit';
