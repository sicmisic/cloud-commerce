import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { resourceName, stackName } from '../lib/naming';

export interface MessagingStackProps extends StackProps {
  readonly envConfig: EnvConfig;
}

/** One SQS queue + DLQ per worker, plus the EventBridge routing rule. */
export interface WorkQueue {
  readonly name: string;
  readonly queue: sqs.Queue;
  readonly dlq: sqs.Queue;
  /** Event `detail-type` values routed to this queue. */
  readonly eventNames: string[];
}

const ROUTING: { name: string; eventNames: string[] }[] = [
  { name: 'payment', eventNames: ['PaymentRequested'] },
  { name: 'shipping', eventNames: ['PaymentCompleted'] },
  {
    name: 'email',
    eventNames: ['OrderCreated', 'PaymentFailed', 'ShipmentDispatched', 'OrderCancelled'],
  },
  { name: 'inventory', eventNames: ['OrderCancelled'] },
];

/**
 * EventBridge domain-event bus + per-worker SQS queues (CLAUDE.md §2, ADR 003).
 * Every queue: visibility timeout ≥ 6× the worker timeout, bounded retries
 * (`maxReceiveCount`), and a DLQ. Alarms on DLQ depth are added in Phase 6.
 */
export class MessagingStack extends Stack {
  readonly eventBus: events.EventBus;
  readonly workQueues: WorkQueue[] = [];

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, { ...props, stackName: stackName('Messaging', props.envConfig.name) });
    const env = props.envConfig;

    this.eventBus = new events.EventBus(this, 'DomainEventBus', {
      eventBusName: resourceName('events', env.name),
    });
    this.eventBus.archive('DomainEventArchive', {
      archiveName: resourceName('event-archive', env.name),
      description: 'All cloud-commerce domain events',
      eventPattern: { account: [Stack.of(this).account] },
      retention: Duration.days(30),
    });

    for (const route of ROUTING) {
      const dlq = new sqs.Queue(this, `${cap(route.name)}Dlq`, {
        queueName: resourceName(`${route.name}-dlq`, env.name),
        retentionPeriod: Duration.days(14),
        enforceSSL: true,
      });
      const queue = new sqs.Queue(this, `${cap(route.name)}Queue`, {
        queueName: resourceName(`${route.name}`, env.name),
        visibilityTimeout: Duration.seconds(180), // 6× the 30s worker timeout
        retentionPeriod: Duration.days(4),
        enforceSSL: true,
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      });

      new events.Rule(this, `${cap(route.name)}Rule`, {
        ruleName: resourceName(`${route.name}-route`, env.name),
        eventBus: this.eventBus,
        eventPattern: { detailType: route.eventNames },
        targets: [
          new targets.SqsQueue(queue, {
            // Preserve the correlation id for the worker runtime.
            message: events.RuleTargetInput.fromEventPath('$'),
          }),
        ],
      });

      this.workQueues.push({ name: route.name, queue, dlq, eventNames: route.eventNames });
    }
  }

  /** JSON the API needs for the admin failed-events endpoints (`DLQ_QUEUES`). */
  dlqConfigJson(): string {
    return JSON.stringify(
      this.workQueues.map((w) => ({
        name: w.name,
        dlqUrl: w.dlq.queueUrl,
        dlqArn: w.dlq.queueArn,
      })),
    );
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
