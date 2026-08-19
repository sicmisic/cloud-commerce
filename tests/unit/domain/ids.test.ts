import { isId, newId, stableHash } from '@cloud-commerce/domain';
import { describe, expect, it } from 'vitest';

describe('ids', () => {
  it('generates prefixed ids', () => {
    const id = newId('order');
    expect(id.startsWith('ord_')).toBe(true);
    expect(isId('order', id)).toBe(true);
    expect(isId('product', id)).toBe(false);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('product')));
    expect(ids.size).toBe(1000);
  });
});

describe('stableHash', () => {
  it('is order-independent for object keys', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
  });

  it('differs when values differ', () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it('is stable across calls', () => {
    const payload = { items: [{ sku: 'ABC', qty: 2 }], total: 100 };
    expect(stableHash(payload)).toBe(stableHash(structuredClone(payload)));
  });
});
