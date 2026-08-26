import type { DomainEvent } from '@cloud-commerce/domain';
import type { InMemoryEventPublisher } from '@cloud-commerce/events';

/**
 * Simulates EventBridge + SQS: drains everything on the {@link InMemoryEventPublisher}
 * through a set of handlers, following events the handlers publish in turn,
 * until the system quiesces. Handlers that throw are recorded (mirrors a
 * message landing on a DLQ after retries).
 */
export interface PumpResult {
  processed: DomainEvent[];
  failures: { event: DomainEvent; error: unknown }[];
}

export async function pumpEvents(
  publisher: InMemoryEventPublisher,
  handlers: ((event: DomainEvent) => Promise<void>)[],
  maxRounds = 20,
): Promise<PumpResult> {
  const result: PumpResult = { processed: [], failures: [] };
  let cursor = 0;

  for (let round = 0; round < maxRounds; round++) {
    const batch = publisher.published.slice(cursor);
    if (batch.length === 0) break;
    cursor = publisher.published.length;

    for (const event of batch) {
      for (const handle of handlers) {
        try {
          await handle(event);
          result.processed.push(event);
        } catch (error) {
          result.failures.push({ event, error });
        }
      }
    }
  }

  return result;
}
