import { z } from 'zod';

import { idempotencyKey } from '../common';

const address = z.object({
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  region: z.string().min(1).max(120),
  postalCode: z.string().min(2).max(20),
  country: z
    .string()
    .length(2, 'ISO 3166-1 alpha-2 country code')
    .transform((c) => c.toUpperCase()),
});

export const createOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1, 'an order needs at least one line')
    .max(50),
  shippingAddress: address,
  // Defaults to the shipping address when omitted.
  billingAddress: address.optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().min(1).max(300).default('cancelled by operator'),
});

export const registerCustomerSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120),
});

export { idempotencyKey };

export type CreateOrderBody = z.infer<typeof createOrderSchema>;
export type CancelOrderBody = z.infer<typeof cancelOrderSchema>;
export type RegisterCustomerBody = z.infer<typeof registerCustomerSchema>;
export type AddressInput = z.infer<typeof address>;
