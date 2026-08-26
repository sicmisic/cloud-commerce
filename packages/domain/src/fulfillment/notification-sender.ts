import { type CustomerRepository } from '../customer/repository';
import {
  type OrderCreatedPayload,
  type PaymentFailedPayload,
  type ShipmentDispatchedPayload,
} from '../order/events';
import { type EmailProvider, type EmailMessage, type EmailTemplate } from '../ports/email-provider';
import { type DomainEvent } from '../shared/events';
import { type IdempotencyStore } from '../shared/idempotency';
import { type Logger, noopLogger } from '../shared/logger';

export interface NotificationSenderDeps {
  readonly provider: EmailProvider;
  readonly customers: CustomerRepository;
  readonly idempotency: IdempotencyStore;
  readonly idempotencyTtlSeconds?: number;
  readonly logger?: Logger;
}

const TEMPLATE_BY_EVENT: Record<string, EmailTemplate> = {
  OrderCreated: 'order-confirmation',
  PaymentFailed: 'payment-failed',
  ShipmentDispatched: 'shipment-dispatched',
  OrderCancelled: 'order-cancelled',
};

/**
 * Consumes `OrderCreated` / `PaymentFailed` / `ShipmentDispatched` /
 * `OrderCancelled` and sends the matching transactional email. Idempotent on
 * `<eventName>#<orderId>` so a redelivery does not re-send.
 */
export class NotificationSender {
  private readonly log: Logger;
  private readonly ttl: number;

  constructor(private readonly deps: NotificationSenderDeps) {
    this.log = deps.logger ?? noopLogger;
    this.ttl = deps.idempotencyTtlSeconds ?? 86_400;
  }

  async handle(event: DomainEvent): Promise<void> {
    const template = TEMPLATE_BY_EVENT[event.name];
    if (!template) {
      this.log.debug({ name: event.name }, 'no email template for event — skipping');
      return;
    }

    const payload = event.payload as
      | OrderCreatedPayload
      | PaymentFailedPayload
      | ShipmentDispatchedPayload
      | { orderId: string; customerId: string };
    const idemKey = `email#${event.name}#${payload.orderId}`;

    const claim = await this.deps.idempotency.claim(idemKey, event.id, this.ttl);
    if (claim.outcome === 'completed') return;

    const customer = await this.deps.customers.findById(payload.customerId);
    if (!customer) {
      this.log.warn({ customerId: payload.customerId }, 'no customer for notification — skipping');
      await this.deps.idempotency.complete(idemKey, { skipped: 'no-customer' });
      return;
    }

    const message: EmailMessage = {
      idempotencyKey: idemKey,
      to: customer.email,
      template,
      data: { ...payload, customerName: customer.name },
      correlationId: event.correlationId,
    };

    try {
      const receipt = await this.deps.provider.send(message);
      await this.deps.idempotency.complete(idemKey, { messageId: receipt.providerMessageId });
      this.log.info({ template, to: customer.email }, 'notification sent');
    } catch (err) {
      await this.deps.idempotency.release(idemKey).catch(() => undefined);
      throw err;
    }
  }
}
