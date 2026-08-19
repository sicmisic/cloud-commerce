/**
 * Transactional email port. Implementations: {@link MockEmailProvider} and a
 * future `SesEmailProvider`.
 */

export type EmailTemplate =
  'order-confirmation' | 'payment-failed' | 'shipment-dispatched' | 'order-cancelled';

export interface EmailMessage {
  readonly idempotencyKey: string;
  readonly to: string;
  readonly template: EmailTemplate;
  readonly data: Record<string, unknown>;
  readonly correlationId: string;
}

export interface EmailReceipt {
  readonly providerMessageId: string;
  readonly acceptedAt: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailReceipt>;
}
