import * as path from 'node:path';

import { Stack, type StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as events from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { functionLogGroup, lambdaDefaults, logRetention, REPO_ROOT } from '../lib/lambda-defaults';
import { resourceName, stackName } from '../lib/naming';

export interface ApiStackProps extends StackProps {
  readonly envConfig: EnvConfig;
  readonly catalogTable: dynamodb.ITable;
  readonly idempotencyTable: dynamodb.ITable;
  readonly eventBus: events.IEventBus;
  /** Secret ARNs the API is allowed to read (Phase 3+). */
  readonly databaseSecretArn?: string;
}

/**
 * The public HTTP surface: one Node 20 Lambda behind an API Gateway HTTP API.
 * The Lambda runs the internal router (apps/api) — a single function keeps
 * cold starts predictable and deployment simple; its IAM role is still scoped
 * to exactly the tables / bus / secrets it uses (CLAUDE.md §8), never a managed
 * policy.
 */
export class ApiStack extends Stack {
  readonly httpApi: apigwv2.HttpApi;
  readonly apiFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, { ...props, stackName: stackName('Api', props.envConfig.name) });
    const env = props.envConfig;

    const functionName = resourceName('api', env.name);
    this.apiFunction = new NodejsFunction(this, 'ApiFunction', {
      ...lambdaDefaults(env),
      functionName,
      logGroup: functionLogGroup(this, functionName, env),
      entry: path.join(REPO_ROOT, 'apps/api/src/handlers/api.ts'),
      handler: 'handler',
      description: 'cloud-commerce HTTP API (internal router)',
      environment: {
        ...lambdaDefaults(env).environment,
        CATALOG_TABLE_NAME: props.catalogTable.tableName,
        IDEMPOTENCY_TABLE_NAME: props.idempotencyTable.tableName,
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        LOG_LEVEL: env.name === 'production' ? 'info' : 'debug',
        ...(props.databaseSecretArn ? { DATABASE_SECRET_ARN: props.databaseSecretArn } : {}),
      },
    });

    // --- Least-privilege grants -------------------------------------------
    props.catalogTable.grantReadWriteData(this.apiFunction);
    props.idempotencyTable.grantReadWriteData(this.apiFunction);
    props.eventBus.grantPutEventsTo(this.apiFunction);

    // --- HTTP API --------------------------------------------------------
    const integration = new HttpLambdaIntegration('ApiIntegration', this.apiFunction);

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: resourceName('http-api', env.name),
      description: 'cloud-commerce public API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-correlation-id'],
        maxAge: Duration.minutes(10),
      },
      defaultIntegration: integration,
    });

    // Catch-all so the internal router owns path dispatch.
    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration,
    });

    // Stage-level throttling — the authoritative rate limit (CLAUDE.md §8).
    const stage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (stage) {
      stage.defaultRouteSettings = {
        throttlingRateLimit: env.apiThrottle.rateLimit,
        throttlingBurstLimit: env.apiThrottle.burstLimit,
      };
    }

    // Access logs -> CloudWatch (structured JSON).
    const accessLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/${resourceName('http-api', env.name)}`,
      retention: logRetention(env.lambdaLogRetentionDays),
    });
    if (stage) {
      stage.accessLogSettings = {
        destinationArn: accessLogs.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          method: '$context.httpMethod',
          route: '$context.routeKey',
          status: '$context.status',
          latencyMs: '$context.responseLatency',
          correlationId: '$context.request.header.x-correlation-id',
        }),
      };
    }

    new CfnOutput(this, 'ApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'Base URL of the cloud-commerce HTTP API',
      exportName: `${stackName('Api', env.name)}-Url`,
    });
  }
}
