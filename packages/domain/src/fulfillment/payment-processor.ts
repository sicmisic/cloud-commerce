import {
  type PaymentCompletedPayload,
  type PaymentFailedPayload,
  type PaymentRequestedPayload,
} from '../order/events';
import { paymentCompletedEvent, paymentFailedEvent } from '../order/events';
import { newPayment } from '../order/payment';
import { type OrderRepository } from '../order/repository';
import { type PaymentProvider } from '../ports/payment-provider';
import { PaymentDeclinedError, DependencyFailureError } from '../shared/errors';
import { type EventPublisher } from '../shared/events';
import { type IdempotencyStore } from '../shared/idempotency';
import { type Logger, noopLogger } from '../shared/logger';

export interface PaymentProcessorDeps {
  readonly orders: OrderRepository;
  readonly provider: PaymentProvider;
  readonly events: EventPublisher;
  readonly idempotency: IdempotencyStore;
  readonly idempotencyTtlSeconds?: number;
  readonly logger?: Logger;
}

/**
 * Consumes `PaymentRequested`. Charges the provider (idempotent), records the
 * result on the payment row, advances the order to `confirmed` on success, and
 * publishes `PaymentCompleted` / `PaymentFailed`.
 *
 * - A **decline** is terminal: record `failed`, publish `PaymentFailed`
 *   (retryable: false), ack the message.
 * - A **transient** provider error is rethrown so SQS retries; after
 *   `maxReceiveCount` the message lands on the DLQ (ADR 003).
 */
export class PaymentProcessor {
  private readonly log: Logger;
  private readonly ttl: number;

  constructor(private readonly deps: PaymentProcessorDeps) {
    this.log = deps.logger ?? noopLogger;
    this.ttl = deps.idempotencyTtlSeconds ?? 86_400;
  }

  async process(payload: PaymentRequestedPayload, correlationId: string): Promise<void> {
    const idemKey = `payment#${payload.paymentId}`;
    const claim = await this.deps.idempotency.claim(idemKey, payload.orderId, this.ttl);
    if (claim.outcome === 'completed') {
      this.log.info({ paymentId: payload.paymentId }, 'payment already processed — skipping');
      return;
    }
    if (claim.outcome === 'in_progress') {
      // Another delivery is mid-flight; let SQS redeliver later.
      throw new DependencyFailureError('idempotency', 'payment claim held by a concurrent attempt');
    }

    try {
      const result = await this.deps.provider.charge({
        idempotencyKey: idemKey,
        orderId: payload.orderId,
        customerId: payload.customerId,
        amount: payload.amount,
        paymentMethodToken: 'tok_default', // Phase 5: real tokenised instrument
        correlationId,
      });

      await this.deps.orders.savePayment({
        ...newPayment({
          orderId: payload.orderId,
          amount: payload.amount,
          provider: this.deps.provider.name,
        }),
        id: payload.paymentId,
        status: 'captured',
        providerRef: result.providerPaymentId,
      });

      await this.deps.orders
        .updateStatus(payload.orderId, 'confirmed', ['pending'])
        .catch((err) => this.log.warn({ err, orderId: payload.orderId }, 'order already advanced'));

      const completed: PaymentCompletedPayload = {
        orderId: payload.orderId,
        paymentId: payload.paymentId,
        customerId: payload.customerId,
        amount: payload.amount,
        providerPaymentId: result.providerPaymentId,
      };
      await this.deps.events.publish(paymentCompletedEvent(completed, correlationId));
      await this.deps.idempotency.complete(idemKey, {
        providerPaymentId: result.providerPaymentId,
      });
      this.log.info({ orderId: payload.orderId }, 'payment captured, order confirmed');
    } catch (err) {
      if (err instanceof PaymentDeclinedError) {
        await this.deps.orders.savePayment({
          ...newPayment({
            orderId: payload.orderId,
            amount: payload.amount,
            provider: this.deps.provider.name,
          }),
          id: payload.paymentId,
          status: 'failed',
          failureReason: err.message,
        });
        const failed: PaymentFailedPayload = {
          orderId: payload.orderId,
          paymentId: payload.paymentId,
          customerId: payload.customerId,
          reason: err.message,
          retryable: false,
        };
        await this.deps.events.publish(paymentFailedEvent(failed, correlationId));
        await this.deps.idempotency.complete(idemKey, { declined: true });
        this.log.warn({ orderId: payload.orderId }, 'payment declined');
        return; // terminal — ack the message
      }

      // Transient — release the claim and let SQS retry.
      await this.deps.idempotency.release(idemKey).catch(() => undefined);
      this.log.error({ err, orderId: payload.orderId }, 'payment charge failed transiently');
      throw err;
    }
  }
}
