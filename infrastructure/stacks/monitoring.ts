import { Stack, type StackProps, Duration } from 'aws-cdk-lib';
import type * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as rds from 'aws-cdk-lib/aws-rds';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { resourceName, stackName } from '../lib/naming';

import { type WorkQueue } from './messaging';

export interface MonitoringStackProps extends StackProps {
  readonly envConfig: EnvConfig;
  readonly apiFunction: lambda.IFunction;
  readonly httpApi: apigwv2.IHttpApi;
  readonly workerFunctions: lambda.IFunction[];
  readonly workQueues: WorkQueue[];
  readonly rdsInstance: rds.IDatabaseInstance;
}

/**
 * Alarms + dashboard (CLAUDE.md §7). Every alarm notifies the SNS topic; wire a
 * subscription with the `ALARM_EMAIL` env var (or add PagerDuty/Slack later).
 *
 * Business metrics (`OrdersCreated`, `PaymentFailures`, …) are emitted by the
 * services as EMF and appear in the `CloudCommerce` namespace.
 */
export class MonitoringStack extends Stack {
  readonly dashboard: cloudwatch.Dashboard;
  readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, { ...props, stackName: stackName('Monitoring', props.envConfig.name) });
    const env = props.envConfig;

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: resourceName('alarms', env.name),
      displayName: 'cloud-commerce alarms',
    });
    if (env.alarmEmail) {
      this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(env.alarmEmail));
    }
    const action = new cwActions.SnsAction(this.alarmTopic);
    const alarm = (
      construct: string,
      metric: cloudwatch.IMetric,
      props2: Partial<cloudwatch.CreateAlarmOptions> & {
        threshold: number;
        evaluationPeriods: number;
      },
    ) => {
      const a = new cloudwatch.Alarm(this, construct, {
        alarmName: resourceName(construct.toLowerCase(), env.name),
        metric,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        ...props2,
      });
      a.addAlarmAction(action);
      a.addOkAction(action);
      return a;
    };

    // --- 1. API Lambda error rate ---------------------------------------
    const apiErrorRate = new cloudwatch.MathExpression({
      expression: '100 * errors / MAX([invocations, 1])',
      usingMetrics: {
        errors: props.apiFunction.metricErrors({ period: Duration.minutes(5) }),
        invocations: props.apiFunction.metricInvocations({ period: Duration.minutes(5) }),
      },
      label: 'API error rate %',
    });
    alarm('ApiLambdaErrorRate', apiErrorRate, { threshold: 2, evaluationPeriods: 2 });

    // --- 2. API 5xx rate ----------------------------------------------
    alarm(
      'Api5xxRate',
      new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5xx',
        dimensionsMap: { ApiId: props.httpApi.apiId },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      { threshold: 5, evaluationPeriods: 2 },
    );

    // --- 3. SQS backlog + 4. DLQ messages -----------------------------
    for (const wq of props.workQueues) {
      alarm(
        `${cap(wq.name)}QueueBacklog`,
        wq.queue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
        { threshold: 100, evaluationPeriods: 3 },
      );
      alarm(
        `${cap(wq.name)}DlqMessages`,
        wq.dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(1) }),
        { threshold: 0, evaluationPeriods: 1 },
      );
    }

    // --- 5. RDS CPU + connections -----------------------------------
    alarm('RdsCpu', props.rdsInstance.metricCPUUtilization({ period: Duration.minutes(5) }), {
      threshold: 80,
      evaluationPeriods: 3,
    });
    alarm(
      'RdsConnections',
      props.rdsInstance.metricDatabaseConnections({ period: Duration.minutes(5) }),
      { threshold: 80, evaluationPeriods: 3 },
    );

    // --- Dashboard --------------------------------------------------
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `cloud-commerce-${env.name}`,
    });

    const business = (name: string) =>
      new cloudwatch.Metric({
        namespace: 'CloudCommerce',
        metricName: name,
        dimensionsMap: { Stage: env.name },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# cloud-commerce — ${env.name}\nAlarms → SNS \`${this.alarmTopic.topicName}\``,
        width: 24,
        height: 2,
      }),
      new cloudwatch.GraphWidget({
        title: 'Orders',
        left: [business('OrdersCreated'), business('OrdersFailed'), business('IdempotentReplay')],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Failures',
        left: [business('PaymentFailures'), business('InventoryReservationFailures')],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API latency (p50 / p99)',
        left: [
          props.apiFunction.metricDuration({ statistic: 'p50', period: Duration.minutes(1) }),
          props.apiFunction.metricDuration({ statistic: 'p99', period: Duration.minutes(1) }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'DLQ depth',
        left: props.workQueues.map((wq) =>
          wq.dlq.metricApproximateNumberOfMessagesVisible({ label: `${wq.name} DLQ` }),
        ),
        width: 12,
      }),
    );
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
