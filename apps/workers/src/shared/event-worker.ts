import { type DomainEvent } from '@cloud-commerce/domain';
import {
  MetricsCollector,
  METRIC,
  createRequestContext,
  getLogger,
  runWithContext,
} from '@cloud-commerce/logging';
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

/**
 * Shared SQS worker runtime. For each record it:
 *  - unwraps the EventBridge envelope to the {@link DomainEvent},
 *  - runs `handle` inside the event's correlation scope,
 *  - reports per-record failures via `batchItemFailures` so only the failed
 *    messages are retried (partial batch response — CLAUDE.md §6).
 *
 * A thrown error keeps the message on the queue; after `maxReceiveCount` it
 * moves to the DLQ.
 */
export interface EventWorkerOptions {
  readonly name: string;
  /** Event names this worker acts on; others are acked and ignored. */
  readonly handles: readonly string[];
  readonly handle: (event: DomainEvent) => Promise<void>;
}

export function createEventWorker(options: EventWorkerOptions) {
  return async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
    const failures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
      const domainEvent = parseRecord(record);
      const ctx = createRequestContext({
        requestId: record.messageId,
        route: `worker/${options.name}`,
      });
      const scopedCtx = domainEvent ? { ...ctx, correlationId: domainEvent.correlationId } : ctx;

      await runWithContext(scopedCtx, async () => {
        const log = getLogger().child({ worker: options.name });
        const metrics = new MetricsCollector({ Worker: options.name });

        if (!domainEvent) {
          log.error({ messageId: record.messageId }, 'unparseable SQS message — sending to DLQ');
          failures.push({ itemIdentifier: record.messageId });
          metrics.count(METRIC.LambdaErrors);
          metrics.flush();
          return;
        }

        if (!options.handles.includes(domainEvent.name)) {
          log.debug({ name: domainEvent.name }, 'event not handled by this worker — acking');
          metrics.flush();
          return;
        }

        try {
          await metrics.time(`${options.name}.handle`, () => options.handle(domainEvent));
          log.info({ event: domainEvent.name, subject: domainEvent.subject }, 'event handled');
        } catch (err) {
          log.error({ err, event: domainEvent.name }, 'event handling failed — will retry');
          metrics.count(METRIC.LambdaErrors);
          failures.push({ itemIdentifier: record.messageId });
        } finally {
          metrics.flush();
        }
      });
    }

    return { batchItemFailures: failures };
  };
}

/** EventBridge → SQS body is the EventBridge event; `detail` is our DomainEvent. */
function parseRecord(record: SQSRecord): DomainEvent | null {
  try {
    const body = JSON.parse(record.body) as { detail?: unknown; [k: string]: unknown };
    const candidate = (body.detail ?? body) as Record<string, unknown>;
    if (
      typeof candidate.name === 'string' &&
      typeof candidate.correlationId === 'string' &&
      'payload' in candidate
    ) {
      return candidate as unknown as DomainEvent;
    }
    return null;
  } catch {
    return null;
  }
}
