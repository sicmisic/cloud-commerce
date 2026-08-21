import {
  applyUpdate,
  createProduct,
  isSellable,
  money,
  ValidationError,
} from '@cloud-commerce/domain';
import { describe, expect, it } from 'vitest';

const base = {
  sku: 'widget-01',
  name: '  Blue Widget  ',
  description: '  A widget  ',
  category: '  Gadgets  ',
  price: money(1999),
  initialStock: 10,
};

describe('createProduct', () => {
  it('normalises sku/name/description/category', () => {
    const p = createProduct(base);
    expect(p.sku).toBe('WIDGET-01');
    expect(p.name).toBe('Blue Widget');
    expect(p.category).toBe('gadgets');
    expect(p.inventory).toEqual({ available: 10, reserved: 0 });
    expect(p.version).toBe(1);
  });

  it('rejects negative or non-integer stock', () => {
    expect(() => createProduct({ ...base, initialStock: -1 })).toThrow(ValidationError);
    expect(() => createProduct({ ...base, initialStock: 2.5 })).toThrow(ValidationError);
  });

  it('rejects a non-positive price', () => {
    expect(() => createProduct({ ...base, price: money(0) })).toThrow(ValidationError);
  });
});

describe('applyUpdate', () => {
  it('bumps version and updates only provided fields', () => {
    const p = createProduct(base);
    const updated = applyUpdate(p, { name: 'Red Widget' });
    expect(updated.name).toBe('Red Widget');
    expect(updated.description).toBe(p.description);
    expect(updated.version).toBe(2);
  });

  it('refuses to modify an archived product', () => {
    const archived = applyUpdate(createProduct(base), { status: 'archived' });
    expect(() => applyUpdate(archived, { name: 'x' })).toThrow(ValidationError);
  });
});

describe('isSellable', () => {
  it('is true only for active products with stock', () => {
    expect(isSellable(createProduct(base))).toBe(true);
    expect(isSellable(createProduct({ ...base, initialStock: 0 }))).toBe(false);
    expect(isSellable(applyUpdate(createProduct(base), { status: 'inactive' }))).toBe(false);
  });
});
