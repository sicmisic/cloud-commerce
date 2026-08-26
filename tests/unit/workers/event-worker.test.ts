import { createEventWorker } from '@cloud-commerce/workers';
import type { SQSEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

function sqsEvent(bodies: unknown[]): SQSEvent {
  return {
    Records: bodies.map((body, i) => ({
      messageId: `m-${i}`,
      receiptHandle: 'rh',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      attributes: {} as never,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn',
      awsRegion: 'us-east-1',
    })),
  };
}

const eventBridgeWrap = (name: string, correlationId = 'c1') => ({
  'detail-type': name,
  detail: {
    id: 'evt_1',
    name,
    correlationId,
    subject: 'order/o1',
    version: 1,
    payload: { orderId: 'o1' },
  },
});

describe('createEventWorker', () => {
  it('routes handled events and acks the rest', async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const worker = createEventWorker({ name: 't', handles: ['OrderCreated'], handle });

    const res = await worker(
      sqsEvent([eventBridgeWrap('OrderCreated'), eventBridgeWrap('SomethingElse')]),
    );

    expect(handle).toHaveBeenCalledTimes(1);
    expect(res.batchItemFailures).toHaveLength(0);
  });

  it('reports only the failed message in batchItemFailures', async () => {
    const handle = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));
    const worker = createEventWorker({ name: 't', handles: ['OrderCreated'], handle });

    const res = await worker(
      sqsEvent([eventBridgeWrap('OrderCreated'), eventBridgeWrap('OrderCreated')]),
    );

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-1' }]);
  });

  it('sends an unparseable message to the DLQ', async () => {
    const worker = createEventWorker({ name: 't', handles: ['OrderCreated'], handle: vi.fn() });
    const res = await worker(sqsEvent(['not json {']));
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-0' }]);
  });

  it('propagates the event correlation id into the handler scope', async () => {
    let seen: string | undefined;
    const { getContext } = await import('@cloud-commerce/logging');
    const worker = createEventWorker({
      name: 't',
      handles: ['OrderCreated'],
      handle: async () => {
        seen = getContext()?.correlationId;
      },
    });
    await worker(sqsEvent([eventBridgeWrap('OrderCreated', 'trace-xyz')]));
    expect(seen).toBe('trace-xyz');
  });
});
