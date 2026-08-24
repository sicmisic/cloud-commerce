import {
  ValidationError,
  canTransition,
  createOrder,
  isTerminal,
  money,
  priceOrder,
  transition,
} from '@cloud-commerce/domain';
import { describe, expect, it } from 'vitest';

const address = {
  name: 'Ada Lovelace',
  line1: '1 Analytical Engine Way',
  city: 'London',
  region: 'London',
  postalCode: 'EC1A 1BB',
  country: 'GB',
};

const line = (over: Partial<{ productId: string; quantity: number; amount: number }> = {}) => ({
  productId: over.productId ?? 'prod_1',
  sku: 'SKU-1',
  name: 'Widget',
  unitPrice: money(over.amount ?? 2000),
  quantity: over.quantity ?? 1,
});

describe('priceOrder', () => {
  it('applies 8% tax and flat shipping below the free threshold', () => {
    const { tax, shippingFee, total } = priceOrder(money(5000));
    expect(tax).toEqual(money(400));
    expect(shippingFee).toEqual(money(899));
    expect(total).toEqual(money(6299));
  });

  it('gives free shipping at or above the threshold', () => {
    const { shippingFee, total } = priceOrder(money(7500));
    expect(shippingFee).toEqual(money(0));
    expect(total).toEqual(money(8100)); // 7500 + 600 tax
  });
});

describe('createOrder', () => {
  it('computes line totals, subtotal and grand total', () => {
    const order = createOrder({
      customerId: 'cust_1',
      lines: [
        line({ amount: 2000, quantity: 2 }),
        line({ productId: 'prod_2', amount: 1500, quantity: 1 }),
      ],
      shippingAddress: address,
      billingAddress: address,
    });
    expect(order.items[0]!.lineTotal).toEqual(money(4000));
    expect(order.subtotal).toEqual(money(5500));
    expect(order.status).toBe('pending');
    expect(order.total.amount).toBe(5500 + 440 + 899);
  });

  it('rejects an empty order', () => {
    expect(() =>
      createOrder({
        customerId: 'c',
        lines: [],
        shippingAddress: address,
        billingAddress: address,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a non-positive quantity', () => {
    expect(() =>
      createOrder({
        customerId: 'c',
        lines: [line({ quantity: 0 })],
        shippingAddress: address,
        billingAddress: address,
      }),
    ).toThrow(ValidationError);
  });
});

describe('order state machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('pending', 'fulfilled')).toBe(false);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
  });

  it('transition throws on an illegal move', () => {
    const order = createOrder({
      customerId: 'c',
      lines: [line()],
      shippingAddress: address,
      billingAddress: address,
    });
    expect(() => transition(order, 'fulfilled')).toThrow(ValidationError);
    expect(transition(order, 'confirmed').status).toBe('confirmed');
  });

  it('marks terminal states', () => {
    expect(isTerminal('fulfilled')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('pending')).toBe(false);
  });
});
