import {
  createRequestContext,
  getContext,
  patchContext,
  runWithContext,
} from '@cloud-commerce/logging';
import { describe, expect, it } from 'vitest';

describe('request context', () => {
  it('has no context outside a scope', () => {
    expect(getContext()).toBeUndefined();
  });

  it('propagates through async calls', async () => {
    const ctx = createRequestContext({ requestId: 'r1' });
    await runWithContext(ctx, async () => {
      await Promise.resolve();
      expect(getContext()?.correlationId).toBe(ctx.correlationId);
    });
  });

  it('reuses an inbound correlation id header', () => {
    const ctx = createRequestContext({ headers: { 'X-Correlation-Id': 'trace-123' } });
    expect(ctx.correlationId).toBe('trace-123');
  });

  it('generates a correlation id when none supplied', () => {
    const ctx = createRequestContext();
    expect(ctx.correlationId).toMatch(/[0-9a-f-]{36}/);
  });

  it('patchContext mutates the active scope only', async () => {
    const ctx = createRequestContext();
    await runWithContext(ctx, async () => {
      patchContext({ userId: 'cust_1', role: 'CUSTOMER' });
      expect(getContext()?.userId).toBe('cust_1');
    });
    expect(ctx.userId).toBe('cust_1');
  });
});
