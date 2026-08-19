import { type Principal } from '@cloud-commerce/auth';
import { type RequestContext } from '@cloud-commerce/logging';

/**
 * Framework-neutral HTTP request/response. The Lambda adapter
 * (`handlers/api.ts`) is the only file that knows about API Gateway payload
 * shapes; everything above works with these types and stays testable without
 * an AWS event.
 */

export interface HttpRequest {
  readonly method: string;
  /** Path without stage prefix, e.g. `/products/prod_123`. */
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly query: Record<string, string>;
  /** Path params filled in by the router. */
  params: Record<string, string>;
  /** Parsed JSON body, or undefined. */
  readonly body: unknown;
  readonly rawBody?: string;
  readonly context: RequestContext;
  /** Set by the auth middleware once the caller is identified. */
  principal?: Principal;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

/** Middleware wraps the next handler in the chain. */
export type Middleware = (next: RouteHandler) => RouteHandler;
