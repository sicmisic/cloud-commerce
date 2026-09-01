import * as path from 'node:path';

import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type * as events from 'aws-cdk-lib/aws-events';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { functionLogGroup, lambdaDefaults, REPO_ROOT } from '../lib/lambda-defaults';
import { resourceName, stackName } from '../lib/naming';

import { type WorkQueue } from './messaging';

export interface WorkersStackProps extends StackProps {
  readonly envConfig: EnvConfig;
  readonly vpc: ec2.IVpc;
  readonly securityGroup: ec2.ISecurityGroup;
  readonly workQueues: WorkQueue[];
  readonly eventBus: events.IEventBus;
  readonly catalogTable: dynamodb.ITable;
  readonly idempotencyTable: dynamodb.ITable;
  readonly databaseSecret: secretsmanager.ISecret;
  /**
   * Deliberate failure scenario (CLAUDE.md §7). `0`–`1` — the fraction of
   * payment charges the mock provider fails transiently. Non-production only;
   * set with `-c paymentFaultRate=0.5`. See docs/troubleshooting.md.
   */
  readonly paymentFaultRate?: number;
}

const HANDLER_ENTRY: Record<string, string> = {
  payment: 'apps/workers/src/payment/handler.ts',
  shipping: 'apps/workers/src/shipping/handler.ts',
  email: 'apps/workers/src/email/handler.ts',
  inventory: 'apps/workers/src/inventory/handler.ts',
};

/**
 * One Lambda per SQS work queue (Phase 4). Each function's IAM role is scoped to
 * exactly the queue it consumes plus the tables / bus / secret it uses
 * (CLAUDE.md §8). `reportBatchItemFailures` is on so only failed messages retry.
 */
export class WorkersStack extends Stack {
  readonly workerFunctions: NodejsFunction[] = [];

  constructor(scope: Construct, id: string, props: WorkersStackProps) {
    super(scope, id, { ...props, stackName: stackName('Workers', props.envConfig.name) });
    const env = props.envConfig;

    const commonEnv = {
      ...lambdaDefaults(env).environment,
      CATALOG_TABLE_NAME: props.catalogTable.tableName,
      IDEMPOTENCY_TABLE_NAME: props.idempotencyTable.tableName,
      EVENT_BUS_NAME: props.eventBus.eventBusName,
      DATABASE_SECRET_ARN: props.databaseSecret.secretArn,
      LOG_LEVEL: env.name === 'production' ? 'info' : 'debug',
      // Fault injector — never armed in production regardless of the flag.
      PAYMENT_MOCK_FAILURE_RATE:
        env.name === 'production' ? '0' : String(props.paymentFaultRate ?? 0),
    };

    for (const wq of props.workQueues) {
      const functionName = resourceName(`worker-${wq.name}`, env.name);
      const fn = new NodejsFunction(this, `${cap(wq.name)}Worker`, {
        ...lambdaDefaults(env),
        functionName,
        logGroup: functionLogGroup(this, functionName, env),
        entry: path.join(REPO_ROOT, HANDLER_ENTRY[wq.name]!),
        handler: 'handler',
        description: `cloud-commerce ${wq.name} worker`,
        timeout: Duration.seconds(30),
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [props.securityGroup],
        environment: commonEnv,
      });

      fn.addEventSource(
        new SqsEventSource(wq.queue, {
          batchSize: 10,
          maxConcurrency: 5,
          reportBatchItemFailures: true,
        }),
      );

      // Least-privilege grants — only what this worker needs.
      wq.queue.grantConsumeMessages(fn);
      props.idempotencyTable.grantReadWriteData(fn);
      props.eventBus.grantPutEventsTo(fn);
      props.databaseSecret.grantRead(fn);

      if (wq.name === 'inventory' || wq.name === 'shipping') {
        props.catalogTable.grantReadWriteData(fn);
      } else if (wq.name === 'payment') {
        props.catalogTable.grantReadData(fn);
      }

      this.workerFunctions.push(fn);
    }
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
