import { type Money } from '../shared/money';

/**
 * Payment provider port. The application/order service depends on this, never on
 * Stripe / the AWS SDK (CLAUDE.md §3). Implementations: {@link MockPaymentProvider}
 * (default) and a future `StripePaymentProvider`.
 */

export interface PaymentChargeRequest {
  /** Idempotency key — provider must not double-charge on retry. */
  readonly idempotencyKey: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly amount: Money;
  /** Opaque tokenised instrument (never raw PAN). */
  readonly paymentMethodToken: string;
  readonly correlationId: string;
}

export type ProviderPaymentStatus = 'authorized' | 'captured' | 'declined';

export interface PaymentResult {
  readonly providerPaymentId: string;
  readonly status: ProviderPaymentStatus;
  readonly amount: Money;
  /** Present when `status === 'declined'`. */
  readonly declineReason?: string;
  readonly processedAt: string;
}

export interface RefundRequest {
  readonly idempotencyKey: string;
  readonly providerPaymentId: string;
  readonly amount: Money;
  readonly correlationId: string;
}

export interface RefundResult {
  readonly providerRefundId: string;
  readonly amount: Money;
  readonly processedAt: string;
}

export interface PaymentProvider {
  readonly name: string;
  charge(request: PaymentChargeRequest): Promise<PaymentResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
}
