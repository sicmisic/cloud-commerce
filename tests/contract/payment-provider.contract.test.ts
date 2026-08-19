import { PaymentDeclinedError, money } from '@cloud-commerce/domain';
import { MockPaymentProvider, type PaymentProvider } from '@cloud-commerce/integrations';
import { describe, expect, it } from 'vitest';

/**
 * Contract the order service relies on. Every PaymentProvider implementation
 * (mock today, Stripe later) must satisfy this suite so response-schema drift is
 * caught (CLAUDE.md §9).
 */
function paymentProviderContract(name: string, makeProvider: () => PaymentProvider): void {
  describe(`PaymentProvider contract: ${name}`, () => {
    const baseRequest = {
      idempotencyKey: 'key-123',
      orderId: 'ord_1',
      customerId: 'cust_1',
      amount: money(4999),
      paymentMethodToken: 'tok_visa',
      correlationId: 'corr-1',
    };

    it('captures a successful charge with a provider id', async () => {
      const provider = makeProvider();
      const result = await provider.charge(baseRequest);
      expect(result.providerPaymentId).toMatch(/./);
      expect(result.status).toBe('captured');
      expect(result.amount).toEqual(baseRequest.amount);
      expect(Date.parse(result.processedAt)).not.toBeNaN();
    });

    it('is idempotent — same key returns the same result', async () => {
      const provider = makeProvider();
      const a = await provider.charge(baseRequest);
      const b = await provider.charge(baseRequest);
      expect(b).toEqual(a);
    });

    it('raises PaymentDeclinedError on a hard decline (non-retryable)', async () => {
      const provider = makeProvider();
      await expect(
        provider.charge({
          ...baseRequest,
          idempotencyKey: 'declined-key',
          paymentMethodToken: 'tok_declined',
        }),
      ).rejects.toBeInstanceOf(PaymentDeclinedError);
    });

    it('refunds against a provider payment id', async () => {
      const provider = makeProvider();
      const charge = await provider.charge(baseRequest);
      const refund = await provider.refund({
        idempotencyKey: 'refund-1',
        providerPaymentId: charge.providerPaymentId,
        amount: charge.amount,
        correlationId: 'corr-1',
      });
      expect(refund.providerRefundId).toMatch(/./);
      expect(refund.amount).toEqual(charge.amount);
    });
  });
}

paymentProviderContract('MockPaymentProvider', () => new MockPaymentProvider({ force: 'success' }));

describe('MockPaymentProvider decline path', () => {
  it('declines when forced', async () => {
    const provider = new MockPaymentProvider({ force: 'decline' });
    await expect(
      provider.charge({
        idempotencyKey: 'k',
        orderId: 'ord_1',
        customerId: 'cust_1',
        amount: money(100),
        paymentMethodToken: 'tok',
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(PaymentDeclinedError);
  });
});
