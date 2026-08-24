import { ValidationError } from '../shared/errors';
import { newId } from '../shared/ids';
import { type Money, add, money, multiply, sum } from '../shared/money';

/**
 * Order lifecycle. The API drives `pending -> confirmed` (payment ok) and
 * `-> cancelled`; workers drive `confirmed -> processing -> fulfilled`
 * (Phase 4).
 */
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'fulfilled',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TERMINAL: OrderStatus[] = ['fulfilled', 'cancelled'];

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

export interface Address {
  readonly name: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface OrderLineInput {
  readonly productId: string;
  readonly quantity: number;
}

export interface OrderItem {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly lineTotal: Money;
}

export interface Order {
  readonly id: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly currency: string;
  readonly items: OrderItem[];
  readonly subtotal: Money;
  readonly tax: Money;
  readonly shippingFee: Money;
  readonly total: Money;
  readonly shippingAddress: Address;
  readonly billingAddress: Address;
  readonly idempotencyKey?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Pricing policy — pure, deterministic, unit-tested (CLAUDE.md-style judgement). */
export const PRICING = {
  taxRate: 0.08,
  freeShippingThreshold: 7500, // minor units ($75.00)
  flatShippingFee: 899,
} as const;

export function priceOrder(subtotal: Money): { tax: Money; shippingFee: Money; total: Money } {
  const tax = multiply(subtotal, PRICING.taxRate);
  const shippingFee =
    subtotal.amount >= PRICING.freeShippingThreshold
      ? money(0, subtotal.currency)
      : money(PRICING.flatShippingFee, subtotal.currency);
  const total = add(add(subtotal, tax), shippingFee);
  return { tax, shippingFee, total };
}

export interface PricedLine {
  productId: string;
  sku: string;
  name: string;
  unitPrice: Money;
  quantity: number;
}

/**
 * Build a new order aggregate from server-priced lines. The caller resolves
 * prices from the catalog — the client's prices are never trusted.
 */
export function createOrder(input: {
  customerId: string;
  lines: PricedLine[];
  shippingAddress: Address;
  billingAddress: Address;
  idempotencyKey?: string;
}): Order {
  if (input.lines.length === 0) {
    throw new ValidationError('an order must have at least one line item');
  }
  const currency = input.lines[0]!.unitPrice.currency;

  const items: OrderItem[] = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ValidationError('line quantity must be a positive integer', {
        productId: line.productId,
        quantity: line.quantity,
      });
    }
    return {
      id: newId('orderItem'),
      productId: line.productId,
      sku: line.sku,
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: multiply(line.unitPrice, line.quantity),
    };
  });

  const subtotal = sum(
    items.map((i) => i.lineTotal),
    currency,
  );
  const { tax, shippingFee, total } = priceOrder(subtotal);
  const ts = new Date().toISOString();

  return {
    id: newId('order'),
    customerId: input.customerId,
    status: 'pending',
    currency,
    items,
    subtotal,
    tax,
    shippingFee,
    total,
    shippingAddress: input.shippingAddress,
    billingAddress: input.billingAddress,
    idempotencyKey: input.idempotencyKey,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(order: Order, to: OrderStatus): Order {
  if (!canTransition(order.status, to)) {
    throw new ValidationError(`illegal order transition ${order.status} -> ${to}`, {
      orderId: order.id,
    });
  }
  return { ...order, status: to, updatedAt: new Date().toISOString() };
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.includes(status);
}

/** Total units to release back to inventory when an order is cancelled. */
export function reservedUnits(order: Order): { productId: string; quantity: number }[] {
  return order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
}

/** All lines in one order must share a currency. */
export function assertCurrency(lines: { unitPrice: Money }[]): void {
  const currencies = new Set(lines.map((l) => l.unitPrice.currency));
  if (currencies.size > 1) {
    throw new ValidationError('all order lines must share one currency', {
      currencies: [...currencies],
    });
  }
}
