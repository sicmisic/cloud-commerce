import { NotFoundError } from '@cloud-commerce/domain';

import { type HttpRequest, type HttpResponse, type RouteHandler } from './types';

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
  /** `METHOD /pattern` — used as the log route label. */
  label: string;
}

/**
 * Minimal path router — no Express. Supports `:param` segments and a trailing
 * `*` wildcard. Deliberately tiny: routing is not where engineering judgement
 * needs to be spent, and a dependency-free router keeps the Lambda cold-start
 * bundle small.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: split(pattern),
      handler,
      label: `${method.toUpperCase()} ${pattern}`,
    });
    return this;
  }

  get = (p: string, h: RouteHandler) => this.add('GET', p, h);
  post = (p: string, h: RouteHandler) => this.add('POST', p, h);
  put = (p: string, h: RouteHandler) => this.add('PUT', p, h);
  patch = (p: string, h: RouteHandler) => this.add('PATCH', p, h);
  delete = (p: string, h: RouteHandler) => this.add('DELETE', p, h);

  /** Resolve a request to a handler, filling `req.params` and `req.context.route`. */
  match(req: HttpRequest): { handler: RouteHandler; label: string } {
    const reqSegments = split(req.path);
    for (const route of this.routes) {
      if (route.method !== req.method.toUpperCase()) continue;
      const params = tryMatch(route.segments, reqSegments);
      if (params) {
        req.params = params;
        (req.context as { route?: string }).route = route.label;
        return { handler: route.handler, label: route.label };
      }
    }
    // A path that matches under a different method -> 405 would be nicer, but
    // 404 keeps the surface minimal and is spec-acceptable.
    throw new NotFoundError('Route', `${req.method} ${req.path}`);
  }

  get size(): number {
    return this.routes.length;
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function tryMatch(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p === '*') {
      params['wildcard'] = actual.slice(i).join('/');
      return params;
    }
    const a = actual[i];
    if (a === undefined) return null;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return null;
    }
  }
  return actual.length === pattern.length ? params : null;
}

export type { HttpResponse };
