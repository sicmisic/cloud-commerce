import { newId } from './ids';

/**
 * Domain event envelope. Producers publish these; EventBridge fans them out to
 * SQS-backed consumers (CLAUDE.md §2). The envelope is transport-agnostic — the
 * `@cloud-commerce/events` package adapts it to `PutEvents`.
 */
export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly name: TName;
  /** Schema version of `payload`; bump on breaking changes. */
  readonly version: number;
  readonly occurredAt: string;
  /** Correlation id of the request that produced the event. */
  readonly correlationId: string;
  /** Aggregate this event is about, e.g. `order/ord_123`. */
  readonly subject: string;
  readonly payload: TPayload;
}

export function makeEvent<TName extends string, TPayload>(input: {
  name: TName;
  version?: number;
  correlationId: string;
  subject: string;
  payload: TPayload;
  occurredAt?: string;
}): DomainEvent<TName, TPayload> {
  return {
    id: newId('event'),
    name: input.name,
    version: input.version ?? 1,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
    subject: input.subject,
    payload: input.payload,
  };
}

/**
 * Port implemented by `@cloud-commerce/events`. Application services depend on
 * this, never on the AWS SDK directly (CLAUDE.md §3).
 */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
  publishBatch(events: DomainEvent[]): Promise<void>;
}
