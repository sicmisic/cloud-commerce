import * as path from 'node:path';

import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Runtime, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Explicit log group for a Lambda, named the way Lambda expects
 * (`/aws/lambda/<fn>`) so the function writes to it without extra permissions.
 */
export function functionLogGroup(scope: Construct, functionName: string, env: EnvConfig): LogGroup {
  return new LogGroup(scope, `${functionName}-Logs`, {
    logGroupName: `/aws/lambda/${functionName}`,
    retention: logRetention(env.lambdaLogRetentionDays),
    removalPolicy: env.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  });
}

const RETENTION_BY_DAYS: Record<number, RetentionDays> = {
  7: RetentionDays.ONE_WEEK,
  30: RetentionDays.ONE_MONTH,
  90: RetentionDays.THREE_MONTHS,
};

/** Map the env-config day count to the CDK enum, defaulting to one month. */
export function logRetention(days: number): RetentionDays {
  return RETENTION_BY_DAYS[days] ?? RetentionDays.ONE_MONTH;
}

/**
 * One place for Lambda defaults so every function in the system is consistent:
 * ARM64 (cheaper/faster), Node 22, X-Ray active tracing, source maps, and a
 * bundle that externalises the AWS SDK (present in the runtime).
 */
export function lambdaDefaults(env: EnvConfig): Partial<NodejsFunctionProps> {
  return {
    runtime: Runtime.NODEJS_22_X,
    architecture: Architecture.ARM_64,
    memorySize: env.lambdaMemoryMb,
    timeout: Duration.seconds(15),
    tracing: Tracing.ACTIVE,
    // Log group is created explicitly by each stack (see `functionLogGroup`) so
    // we avoid the deprecated `logRetention` custom resource.
    bundling: {
      format: OutputFormat.CJS,
      target: 'node22',
      sourceMap: true,
      minify: true,
      externalModules: ['@aws-sdk/*'],
    },
    environment: {
      NODE_OPTIONS: '--enable-source-maps',
      STAGE: env.name,
      SERVICE_NAME: 'cloud-commerce',
    },
  };
}
