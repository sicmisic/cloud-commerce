import { ValidationError } from './errors';

/**
 * Money as an integer number of minor units (cents). Floating point is never
 * used for monetary arithmetic. Currency is tracked so mixed-currency maths
 * throws instead of silently producing nonsense.
 */
export interface Money {
  /** Integer minor units, e.g. $12.34 -> 1234. */
  readonly amount: number;
  readonly currency: string;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function money(amount: number, currency = 'USD'): Money {
  if (!Number.isInteger(amount)) {
    throw new ValidationError('Money.amount must be an integer number of minor units', { amount });
  }
  if (!CURRENCY_RE.test(currency)) {
    throw new ValidationError('Money.currency must be an ISO-4217 alpha code', { currency });
  }
  return { amount, currency };
}

export function fromDecimal(value: number, currency = 'USD'): Money {
  return money(Math.round(value * 100), currency);
}

export function toDecimal(m: Money): number {
  return m.amount / 100;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new ValidationError('Cannot combine amounts of different currencies', {
      left: a.currency,
      right: b.currency,
    });
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function multiply(a: Money, factor: number): Money {
  return { amount: Math.round(a.amount * factor), currency: a.currency };
}

export function sum(items: Money[], currency = 'USD'): Money {
  return items.reduce((acc, m) => add(acc, m), money(0, currency));
}

export function isPositive(m: Money): boolean {
  return m.amount > 0;
}

export function format(m: Money): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currency }).format(
    toDecimal(m),
  );
}
