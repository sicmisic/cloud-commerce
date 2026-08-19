import { randomUUID } from 'node:crypto';

/**
 * Prefixed, sortable-ish identifiers. The prefix makes ids self-describing in
 * logs and prevents accidentally passing an order id where a product id is
 * expected.
 */

const PREFIXES = {
  product: 'prod',
  customer: 'cust',
  order: 'ord',
  orderItem: 'oit',
  payment: 'pay',
  shipment: 'shp',
  event: 'evt',
} as const;

export type EntityKind = keyof typeof PREFIXES;

export function newId(kind: EntityKind): string {
  return `${PREFIXES[kind]}_${randomUUID()}`;
}

export function isId(kind: EntityKind, value: string): boolean {
  return value.startsWith(`${PREFIXES[kind]}_`);
}

/** Deterministic hash of an arbitrary payload — used for idempotency requestHash. */
export function stableHash(payload: unknown): string {
  const json = JSON.stringify(sortKeys(payload));
  // FNV-1a 64-bit, hex encoded. Not cryptographic — only for equality checks.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of Buffer.from(json, 'utf8')) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}
