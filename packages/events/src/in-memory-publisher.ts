import { type DomainEvent, type EventPublisher } from '@cloud-commerce/domain';

/**
 * Test / local double. Records everything published so unit and E2E tests can
 * assert on emitted events without EventBridge.
 */
export class InMemoryEventPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];
  private failNext = false;

  async publish(event: DomainEvent): Promise<void> {
    await this.publishBatch([event]);
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('InMemoryEventPublisher: simulated failure');
    }
    this.published.push(...events);
  }

  /** Arrange a failure on the next publish call. */
  simulateFailureOnce(): void {
    this.failNext = true;
  }

  byName(name: string): DomainEvent[] {
    return this.published.filter((e) => e.name === name);
  }

  clear(): void {
    this.published.length = 0;
  }
}
