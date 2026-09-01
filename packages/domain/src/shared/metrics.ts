/**
 * Metrics port. Keeps the domain free of a concrete metrics dependency while
 * letting application services emit the business counters the spec calls for
 * (CLAUDE.md §7): OrdersCreated, OrdersFailed, PaymentFailures,
 * InventoryReservationFailures, ...
 *
 * `@cloud-commerce/logging`'s EMF emitter is adapted to this in the composition
 * roots; tests use {@link noopMetrics}.
 */
export interface MetricsSink {
  increment(name: string, value?: number): void;
}

export const noopMetrics: MetricsSink = {
  increment: () => undefined,
};

/** The business metric names (mirror of the ops spec). */
export const BUSINESS_METRIC = {
  OrdersCreated: 'OrdersCreated',
  OrdersFailed: 'OrdersFailed',
  PaymentFailures: 'PaymentFailures',
  InventoryReservationFailures: 'InventoryReservationFailures',
  IdempotentReplay: 'IdempotentReplay',
} as const;
