import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import {
  type DomainEvent,
  type EventPublisher,
  DependencyFailureError,
} from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

import { EVENT_SOURCE } from './names';

const log = logger('EventBridgeEventPublisher');

/** PutEvents accepts at most 10 entries per call. */
const MAX_BATCH = 10;

export interface EventBridgeEventPublisherOptions {
  eventBusName: string;
  client?: EventBridgeClient;
}

/**
 * Adapts {@link DomainEvent} to EventBridge `PutEvents`. Producers publish once;
 * EventBridge rules (messaging stack) route each event to the SQS queues that
 * care about it (CLAUDE.md §2).
 */
export class EventBridgeEventPublisher implements EventPublisher {
  private readonly client: EventBridgeClient;
  private readonly eventBusName: string;

  constructor(options: EventBridgeEventPublisherOptions) {
    this.eventBusName = options.eventBusName;
    this.client = options.client ?? new EventBridgeClient({});
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.publishBatch([event]);
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    for (let i = 0; i < events.length; i += MAX_BATCH) {
      const chunk = events.slice(i, i + MAX_BATCH);
      const entries: PutEventsRequestEntry[] = chunk.map((event) => ({
        EventBusName: this.eventBusName,
        Source: EVENT_SOURCE,
        DetailType: event.name,
        Detail: JSON.stringify(event),
        Time: new Date(event.occurredAt),
        TraceHeader: event.correlationId,
      }));

      let response;
      try {
        response = await this.client.send(new PutEventsCommand({ Entries: entries }));
      } catch (err) {
        log.error({ err, count: chunk.length }, 'PutEvents call failed');
        throw new DependencyFailureError('eventbridge', err);
      }

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const failures = (response.Entries ?? [])
          .map((entry, idx) => ({ entry, event: chunk[idx] }))
          .filter(({ entry }) => entry.ErrorCode);
        log.error(
          { failures: failures.map((f) => ({ id: f.event?.id, code: f.entry.ErrorCode })) },
          'PutEvents partial failure',
        );
        throw new DependencyFailureError(
          'eventbridge',
          `${response.FailedEntryCount} entries failed`,
        );
      }

      log.debug({ count: chunk.length, names: chunk.map((e) => e.name) }, 'events published');
    }
  }
}
