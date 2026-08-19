import { z } from 'zod';

/** Shared primitives reused across request schemas. */

export const idParam = (prefix: string) =>
  z
    .string()
    .min(1)
    .regex(new RegExp(`^${prefix}_[0-9a-f-]{36}$`), `must be a valid ${prefix} id`);

export const money = z.object({
  amount: z.number().int('amount must be minor units (integer)').nonnegative(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'ISO-4217 alpha code')
    .default('USD'),
});

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

export const sku = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'SKU must be uppercase alphanumeric with dashes');

export const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a kebab-case slug');

/** Header schema for retry-safe mutations (CLAUDE.md §6). */
export const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Idempotency-Key contains invalid characters');

export type PaginationQuery = z.infer<typeof paginationQuery>;
export type MoneyInput = z.infer<typeof money>;
