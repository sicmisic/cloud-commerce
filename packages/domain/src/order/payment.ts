import { newId } from '../shared/ids';
import { type Money } from '../shared/money';

export const PAYMENT_STATUSES = ['pending', 'captured', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Payment {
  readonly id: string;
  readonly orderId: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly provider: string;
  readonly providerRef?: string;
  readonly failureReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function newPayment(input: { orderId: string; amount: Money; provider: string }): Payment {
  const ts = new Date().toISOString();
  return {
    id: newId('payment'),
    orderId: input.orderId,
    status: 'pending',
    amount: input.amount,
    provider: input.provider,
    createdAt: ts,
    updatedAt: ts,
  };
}
