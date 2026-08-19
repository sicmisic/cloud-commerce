import {
  add,
  fromDecimal,
  money,
  multiply,
  subtract,
  sum,
  toDecimal,
  format,
} from '@cloud-commerce/domain';
import { ValidationError } from '@cloud-commerce/domain';
import { describe, expect, it } from 'vitest';

describe('Money', () => {
  it('rejects non-integer minor units', () => {
    expect(() => money(12.5)).toThrow(ValidationError);
  });

  it('rejects bad currency codes', () => {
    expect(() => money(100, 'dollars')).toThrow(ValidationError);
  });

  it('converts to and from decimals without float drift', () => {
    expect(fromDecimal(19.99)).toEqual({ amount: 1999, currency: 'USD' });
    expect(toDecimal({ amount: 1999, currency: 'USD' })).toBe(19.99);
  });

  it('adds and subtracts same-currency amounts', () => {
    expect(add(money(1000), money(250))).toEqual(money(1250));
    expect(subtract(money(1000), money(250))).toEqual(money(750));
  });

  it('throws on mixed-currency arithmetic', () => {
    expect(() => add(money(100, 'USD'), money(100, 'EUR'))).toThrow(ValidationError);
  });

  it('multiplies and rounds to nearest minor unit', () => {
    expect(multiply(money(1999), 3)).toEqual(money(5997));
    expect(multiply(money(100), 0.333)).toEqual(money(33));
  });

  it('sums a list', () => {
    expect(sum([money(100), money(200), money(300)])).toEqual(money(600));
    expect(sum([])).toEqual(money(0));
  });

  it('formats for display', () => {
    expect(format(money(123456))).toBe('$1,234.56');
  });
});
