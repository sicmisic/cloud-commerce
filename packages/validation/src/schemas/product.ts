import { z } from 'zod';

import { money, paginationQuery, sku } from '../common';

const PRODUCT_STATUS = z.enum(['active', 'inactive', 'archived']);

export const createProductSchema = z.object({
  sku,
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  category: z.string().min(1).max(80),
  price: money,
  initialStock: z.number().int().min(0).max(1_000_000),
  status: PRODUCT_STATUS.optional(),
  imageKeys: z.array(z.string().min(1).max(400)).max(12).optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(4000),
    category: z.string().min(1).max(80),
    price: money,
    status: PRODUCT_STATUS,
    imageKeys: z.array(z.string().min(1).max(400)).max(12),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'update requires at least one field',
  });

export const listProductsQuerySchema = paginationQuery.extend({
  category: z.string().min(1).max(80).optional(),
  status: PRODUCT_STATUS.optional(),
});

export const adjustStockSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, 'delta must be non-zero'),
  reason: z.string().min(1).max(200).optional(),
});

export type CreateProductBody = z.infer<typeof createProductSchema>;
export type UpdateProductBody = z.infer<typeof updateProductSchema>;
export type ListProductsQueryParams = z.infer<typeof listProductsQuerySchema>;
export type AdjustStockBody = z.infer<typeof adjustStockSchema>;
