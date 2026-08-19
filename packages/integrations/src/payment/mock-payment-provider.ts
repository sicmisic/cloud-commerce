import { randomUUID } from 'node:crypto';

import { PaymentDeclinedError, DependencyFailureError } from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

import { simulate, SimulatedProviderError, type SimulationConfig } from '../shared/simulate';

import {
  type PaymentProvider,
  type PaymentChargeRequest,
  type PaymentResult,
  type RefundRequest,
  type RefundResult,
} from './provider';

const log = logger('MockPaymentProvider');

/**
 * In-memory payment provider. Backs local dev, all unit/contract tests, and the
 * deliberate failure scenario (CLAUDE.md §7) — set `serverErrorRate` to make
 * `charge` throw retryable errors at a controlled rate.
 *
 * Idempotent: a repeated `idempotencyKey` returns the original result.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly charges = new Map<string, PaymentResult>();
  private readonly refunds = new Map<string, RefundResult>();

  constructor(private readonly simulation: SimulationConfig = {}) {}

  async charge(request: PaymentChargeRequest): Promise<PaymentResult> {
    const existing = this.charges.get(request.idempotencyKey);
    if (existing) {
      log.info({ idempotencyKey: request.idempotencyKey }, 'returning cached charge (idempotent)');
      return existing;
    }

    // Deterministic test seam, mirroring Stripe-style test tokens.
    if (/decline/i.test(request.paymentMethodToken)) {
      throw new PaymentDeclinedError('card_declined', { orderId: request.orderId });
    }

    let outcome: 'success' | 'decline';
    try {
      outcome = await simulate(this.simulation);
    } catch (err) {
      if (err instanceof SimulatedProviderError) {
        log.warn({ outcome: err.outcome, orderId: request.orderId }, 'simulated transient failure');
        throw new DependencyFailureError('payment-provider', err.message);
      }
      throw err;
    }

    if (outcome === 'decline') {
      // A decline is terminal — do not retry.
      throw new PaymentDeclinedError('card_declined', { orderId: request.orderId });
    }

    const result: PaymentResult = {
      providerPaymentId: `mock_pay_${randomUUID()}`,
      status: 'captured',
      amount: request.amount,
      processedAt: new Date().toISOString(),
    };
    this.charges.set(request.idempotencyKey, result);
    log.info(
      { orderId: request.orderId, providerPaymentId: result.providerPaymentId },
      'charge captured',
    );
    return result;
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const existing = this.refunds.get(request.idempotencyKey);
    if (existing) return existing;

    const result: RefundResult = {
      providerRefundId: `mock_ref_${randomUUID()}`,
      amount: request.amount,
      processedAt: new Date().toISOString(),
    };
    this.refunds.set(request.idempotencyKey, result);
    return result;
  }

  /** Test helper. */
  reset(): void {
    this.charges.clear();
    this.refunds.clear();
  }
}
