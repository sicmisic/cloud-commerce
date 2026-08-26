import { __resetContainer, __setContainer, handler } from '@cloud-commerce/api';
import type { DlqAdminPort, FailedEventSummary, RetryResult } from '@cloud-commerce/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeContext, makeEvent, parseJsonBody } from '../helpers/api-gateway';

const asOps = { 'x-debug-claims': JSON.stringify({ sub: 'u', 'cognito:groups': ['OPERATIONS'] }) };
const asCustomer = {
  'x-debug-claims': JSON.stringify({ sub: 'u2', 'cognito:groups': ['CUSTOMER'] }),
};

class FakeDlqAdmin implements DlqAdminPort {
  retried: string[] = [];
  async list(): Promise<FailedEventSummary[]> {
    return [
      { queue: 'payment', approximateMessages: 2, oldestSampledAt: null, sample: [] },
      { queue: 'email', approximateMessages: 0, oldestSampledAt: null, sample: [] },
    ];
  }
  async retry(queueName: string): Promise<RetryResult> {
    this.retried.push(queueName);
    return { queue: queueName, taskHandle: 'task-1' };
  }
  async retryStatus(): Promise<unknown> {
    return [{ Status: 'RUNNING' }];
  }
}

describe('E2E: admin failed-events', () => {
  let dlq: FakeDlqAdmin;

  beforeEach(() => {
    dlq = new FakeDlqAdmin();
    __setContainer({ dlqAdmin: dlq });
  });
  afterEach(() => __resetContainer());

  it('requires the OPERATIONS role', async () => {
    const res = await handler(
      makeEvent('GET', '/admin/failed-events', { headers: asCustomer }),
      makeContext(),
    );
    expect(res.statusCode).toBe(403);
  });

  it('lists DLQ depth per queue', async () => {
    const res = await handler(
      makeEvent('GET', '/admin/failed-events', { headers: asOps }),
      makeContext(),
    );
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<{ totalFailed: number; queues: unknown[] }>(res.body as string);
    expect(body.totalFailed).toBe(2);
    expect(body.queues).toHaveLength(2);
  });

  it('starts a redrive for a named queue', async () => {
    const res = await handler(
      makeEvent('POST', '/admin/failed-events/payment/retry', { headers: asOps }),
      makeContext(),
    );
    expect(res.statusCode).toBe(202);
    expect(dlq.retried).toEqual(['payment']);
  });
});
