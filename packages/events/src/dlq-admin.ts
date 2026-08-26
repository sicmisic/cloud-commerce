import {
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
  StartMessageMoveTaskCommand,
  ListMessageMoveTasksCommand,
} from '@aws-sdk/client-sqs';
import { DependencyFailureError, NotFoundError } from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

const log = logger('DlqAdmin');

export interface DlqDescriptor {
  /** Logical name: payment | email | shipping | inventory. */
  readonly name: string;
  readonly dlqUrl: string;
  readonly dlqArn: string;
}

export interface FailedEventSummary {
  readonly queue: string;
  readonly approximateMessages: number;
  /** Age of the oldest sampled message (best-effort — from ReceiveMessage). */
  readonly oldestSampledAt: string | null;
  readonly sample: FailedEventSample[];
}

export interface FailedEventSample {
  readonly messageId: string;
  readonly eventName?: string;
  readonly subject?: string;
  readonly correlationId?: string;
  readonly receiveCount: number;
  readonly firstSeenAt: string | null;
  readonly bodyPreview: string;
}

export interface RetryResult {
  readonly queue: string;
  readonly taskHandle: string;
}

/** Port so the API controller / tests do not depend on the SQS-backed class. */
export interface DlqAdminPort {
  list(sampleSize?: number): Promise<FailedEventSummary[]>;
  retry(queueName: string): Promise<RetryResult>;
  retryStatus(queueName: string): Promise<unknown>;
}

/**
 * Operations surface for the dead-letter queues (CLAUDE.md §6). `list` shows
 * depth + a non-destructive sample of each DLQ; `retry` uses SQS's native
 * message-move task to re-drive a DLQ back to its source queue.
 */
export class DlqAdmin implements DlqAdminPort {
  private readonly client: SQSClient;

  constructor(
    private readonly queues: DlqDescriptor[],
    client?: SQSClient,
  ) {
    this.client = client ?? new SQSClient({});
  }

  async list(sampleSize = 5): Promise<FailedEventSummary[]> {
    return Promise.all(this.queues.map((q) => this.describe(q, sampleSize)));
  }

  private async describe(q: DlqDescriptor, sampleSize: number): Promise<FailedEventSummary> {
    try {
      const attrs = await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: q.dlqUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      );
      const approximateMessages = Number(attrs.Attributes?.ApproximateNumberOfMessages ?? 0);

      let sample: FailedEventSample[] = [];
      if (approximateMessages > 0 && sampleSize > 0) {
        const received = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: q.dlqUrl,
            MaxNumberOfMessages: Math.min(sampleSize, 10),
            VisibilityTimeout: 5, // brief — we are only peeking
            MessageSystemAttributeNames: ['ApproximateReceiveCount', 'SentTimestamp'],
          }),
        );
        sample = (received.Messages ?? []).map((m) => {
          const parsed = safeParse(m.Body ?? '');
          const detail = (parsed?.detail ?? parsed) as Record<string, unknown> | undefined;
          const sent = m.Attributes?.SentTimestamp;
          return {
            messageId: m.MessageId ?? 'unknown',
            eventName: typeof detail?.name === 'string' ? detail.name : undefined,
            subject: typeof detail?.subject === 'string' ? detail.subject : undefined,
            correlationId:
              typeof detail?.correlationId === 'string' ? detail.correlationId : undefined,
            receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? 0),
            firstSeenAt: sent ? new Date(Number(sent)).toISOString() : null,
            bodyPreview: (m.Body ?? '').slice(0, 500),
          };
        });
      }

      return {
        queue: q.name,
        approximateMessages,
        oldestSampledAt:
          sample
            .map((s) => s.firstSeenAt)
            .filter(Boolean)
            .sort()[0] ?? null,
        sample,
      };
    } catch (err) {
      log.error({ err, queue: q.name }, 'failed to describe DLQ');
      throw new DependencyFailureError('sqs', err);
    }
  }

  async retry(queueName: string): Promise<RetryResult> {
    const q = this.queues.find((x) => x.name === queueName);
    if (!q) throw new NotFoundError('DLQ', queueName);
    try {
      const result = await this.client.send(
        new StartMessageMoveTaskCommand({ SourceArn: q.dlqArn }),
      );
      log.info({ queue: queueName, taskHandle: result.TaskHandle }, 'DLQ redrive task started');
      return { queue: queueName, taskHandle: result.TaskHandle ?? '' };
    } catch (err) {
      log.error({ err, queue: queueName }, 'failed to start DLQ redrive');
      throw new DependencyFailureError('sqs', err);
    }
  }

  async retryStatus(queueName: string): Promise<unknown> {
    const q = this.queues.find((x) => x.name === queueName);
    if (!q) throw new NotFoundError('DLQ', queueName);
    const result = await this.client.send(
      new ListMessageMoveTasksCommand({ SourceArn: q.dlqArn, MaxResults: 5 }),
    );
    return result.Results ?? [];
  }
}

function safeParse(raw: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
