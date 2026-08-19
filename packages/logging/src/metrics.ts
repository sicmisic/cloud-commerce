import { getConfig } from '@cloud-commerce/config';

import { getContext } from './context';
import { getLogger } from './logger';

/**
 * CloudWatch metrics via the Embedded Metric Format (EMF). Emitting a single
 * structured log line lets CloudWatch extract metrics without a synchronous
 * `PutMetricData` call on the request path (CLAUDE.md §7).
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */

export type MetricUnit = 'Count' | 'Milliseconds' | 'Seconds' | 'Bytes' | 'Percent' | 'None';

/** The metric names the spec calls out (CLAUDE.md §7). */
export const METRIC = {
  OrdersCreated: 'OrdersCreated',
  OrdersFailed: 'OrdersFailed',
  PaymentFailures: 'PaymentFailures',
  InventoryReservationFailures: 'InventoryReservationFailures',
  LambdaErrors: 'LambdaErrors',
  LambdaDuration: 'LambdaDuration',
  QueueDepth: 'QueueDepth',
  DLQMessages: 'DLQMessages',
  IdempotentReplay: 'IdempotentReplay',
  ExternalProviderLatency: 'ExternalProviderLatency',
} as const;

export type MetricName = (typeof METRIC)[keyof typeof METRIC];

interface PendingMetric {
  name: string;
  unit: MetricUnit;
  value: number;
}

/**
 * Collects metrics for one unit of work and flushes them as one EMF blob.
 * Create one per handler invocation; call {@link flush} in a `finally`.
 */
export class MetricsCollector {
  private readonly namespace: string;
  private readonly dimensions: Record<string, string>;
  private readonly metrics: PendingMetric[] = [];
  private readonly properties: Record<string, unknown> = {};

  constructor(dimensions: Record<string, string> = {}) {
    let stage = 'dev';
    try {
      stage = getConfig().stage;
    } catch {
      /* config not loaded (e.g. unit test) — fall back to default */
    }
    this.namespace = 'CloudCommerce';
    this.dimensions = { Stage: stage, ...dimensions };
  }

  count(name: MetricName | string, value = 1): this {
    this.metrics.push({ name, unit: 'Count', value });
    return this;
  }

  duration(name: MetricName | string, milliseconds: number): this {
    this.metrics.push({ name, unit: 'Milliseconds', value: milliseconds });
    return this;
  }

  gauge(name: MetricName | string, value: number, unit: MetricUnit = 'None'): this {
    this.metrics.push({ name, unit, value });
    return this;
  }

  /** Attach a non-metric property (searchable in CloudWatch Logs Insights). */
  property(key: string, value: unknown): this {
    this.properties[key] = value;
    return this;
  }

  /** Time an async operation and record it as a duration metric. */
  async time<T>(name: MetricName | string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.duration(name, Math.round(performance.now() - start));
    }
  }

  flush(): void {
    if (this.metrics.length === 0) return;
    const ctx = getContext();
    const emf = {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: this.namespace,
            Dimensions: [Object.keys(this.dimensions)],
            Metrics: this.metrics.map(({ name, unit }) => ({ Name: name, Unit: unit })),
          },
        ],
      },
      ...this.dimensions,
      ...this.properties,
      ...(ctx ? { correlationId: ctx.correlationId, requestId: ctx.requestId } : {}),
      ...Object.fromEntries(this.metrics.map((m) => [m.name, m.value])),
      message: 'emf.metrics',
    };
    getLogger().info(emf);
    this.metrics.length = 0;
  }
}

/** Fire-and-forget single metric (its own EMF line). */
export function emitMetric(
  name: MetricName | string,
  value = 1,
  unit: MetricUnit = 'Count',
  dimensions: Record<string, string> = {},
): void {
  const collector = new MetricsCollector(dimensions);
  collector.gauge(name, value, unit);
  collector.flush();
}
