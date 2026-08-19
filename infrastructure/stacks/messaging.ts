import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { resourceName, stackName } from '../lib/naming';

export interface MessagingStackProps extends StackProps {
  readonly envConfig: EnvConfig;
}

/**
 * EventBridge domain-event bus (CLAUDE.md §2). SQS queues (payment/email/
 * shipping/inventory), DLQs, and EventBridge rules are added in Phase 4.
 */
export class MessagingStack extends Stack {
  readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, { ...props, stackName: stackName('Messaging', props.envConfig.name) });
    const env = props.envConfig;

    this.eventBus = new events.EventBus(this, 'DomainEventBus', {
      eventBusName: resourceName('events', env.name),
    });

    // Archive every domain event for 30 days — supports replay and audit.
    this.eventBus.archive('DomainEventArchive', {
      archiveName: resourceName('event-archive', env.name),
      description: 'All cloud-commerce domain events',
      eventPattern: { account: [Stack.of(this).account] },
      retention: Duration.days(30),
    });
  }
}
