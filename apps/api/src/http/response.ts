import { type HttpResponse } from './types';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponse {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  };
}

export const ok = (body: unknown, headers?: Record<string, string>) => json(200, body, headers);
export const created = (body: unknown, location?: string) =>
  json(201, body, location ? { location } : {});
export const accepted = (body: unknown) => json(202, body);

export function noContent(): HttpResponse {
  return { statusCode: 204, headers: {}, body: '' };
}

/**
 * RFC 7807-style problem document. `type` is a stable slug the frontend can
 * switch on; `title` is human text; `detail` is request-specific.
 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export function problem(p: Problem): HttpResponse {
  return {
    statusCode: p.status,
    headers: { 'content-type': 'application/problem+json; charset=utf-8' },
    body: JSON.stringify(p),
  };
}
