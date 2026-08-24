/**
 * Cursor-based pagination. DynamoDB pages with an opaque `LastEvaluatedKey`;
 * we base64-encode it so the transport (query string) never leaks the key shape.
 */

export interface PageRequest {
  /** Requested page size; callers normalise with {@link normalizeLimit}. */
  readonly limit?: number;
  /** Opaque cursor returned by a previous page. */
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: T[];
  /** Present when more results exist; pass back as `cursor`. */
  readonly nextCursor?: string;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function normalizeLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT);
}

export function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
