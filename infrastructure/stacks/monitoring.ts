import { Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { stackName } from '../lib/naming';

export interface MonitoringStackProps extends StackProps {
  readonly envConfig: EnvConfig;
  readonly apiFunctionName: string;
}

/**
 * Observability plane (CLAUDE.md §7). Phase 1 stands up the dashboard; Phase 6
 * adds the alarm set (Lambda error rate, API 5xx rate, SQS backlog, DLQ
 * messages, RDS CPU/connections) and the SNS notification topic.
 */
export class MonitoringStack extends Stack {
  readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, { ...props, stackName: stackName('Monitoring', props.envConfig.name) });

    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `cloud-commerce-${props.envConfig.name}`,
    });

    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# cloud-commerce — ${props.envConfig.name}\nAPI Lambda: \`${props.apiFunctionName}\``,
        width: 24,
        height: 2,
      }),
    );
  }
}
