import { randomUUID } from 'node:crypto';

import {
  DependencyFailureError,
  type EmailProvider,
  type EmailMessage,
  type EmailReceipt,
} from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

import { simulate, SimulatedProviderError, type SimulationConfig } from '../shared/simulate';

const log = logger('MockEmailProvider');

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  readonly sent: EmailMessage[] = [];
  private readonly receipts = new Map<string, EmailReceipt>();

  constructor(private readonly simulation: SimulationConfig = {}) {}

  async send(message: EmailMessage): Promise<EmailReceipt> {
    const existing = this.receipts.get(message.idempotencyKey);
    if (existing) return existing;

    try {
      await simulate(this.simulation);
    } catch (err) {
      if (err instanceof SimulatedProviderError) {
        throw new DependencyFailureError('email-provider', err.message);
      }
      throw err;
    }

    const receipt: EmailReceipt = {
      providerMessageId: `mock_msg_${randomUUID()}`,
      acceptedAt: new Date().toISOString(),
    };
    this.receipts.set(message.idempotencyKey, receipt);
    this.sent.push(message);
    log.info({ to: message.to, template: message.template }, 'email accepted');
    return receipt;
  }

  reset(): void {
    this.sent.length = 0;
    this.receipts.clear();
  }
}
