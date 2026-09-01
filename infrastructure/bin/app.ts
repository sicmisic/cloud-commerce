#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';

import { resolveEnv } from '../config/environments';
import { ApiStack } from '../stacks/api';
import { AuthStack } from '../stacks/auth';
import { DatabaseStack } from '../stacks/database';
import { MessagingStack } from '../stacks/messaging';
import { MonitoringStack } from '../stacks/monitoring';
import { NetworkStack } from '../stacks/network';
import { RdsStack } from '../stacks/rds';
import { SecretsStack } from '../stacks/secrets';
import { StorageStack } from '../stacks/storage';
import { WorkersStack } from '../stacks/workers';

const app = new App();

// `-c env=staging` or ENV=staging. Defaults to dev.
const envName = app.node.tryGetContext('env') ?? process.env.ENV ?? 'dev';
const envConfig = resolveEnv(envName);
const env = { account: envConfig.account, region: envConfig.region };

const storage = new StorageStack(app, `Storage-${envConfig.name}`, { env, envConfig });
const database = new DatabaseStack(app, `Database-${envConfig.name}`, { env, envConfig });
const messaging = new MessagingStack(app, `Messaging-${envConfig.name}`, { env, envConfig });
const network = new NetworkStack(app, `Network-${envConfig.name}`, { env, envConfig });

const rds = new RdsStack(app, `Rds-${envConfig.name}`, {
  env,
  envConfig,
  vpc: network.vpc,
  appSecurityGroup: network.lambdaSecurityGroup,
});

const secrets = new SecretsStack(app, `Secrets-${envConfig.name}`, { env, envConfig });

const auth = new AuthStack(app, `Auth-${envConfig.name}`, {
  env,
  envConfig,
  vpc: network.vpc,
  securityGroup: network.lambdaSecurityGroup,
  databaseSecret: rds.secret,
  catalogTable: database.catalogTable,
});

const api = new ApiStack(app, `Api-${envConfig.name}`, {
  env,
  envConfig,
  catalogTable: database.catalogTable,
  idempotencyTable: database.idempotencyTable,
  eventBus: messaging.eventBus,
  vpc: network.vpc,
  securityGroup: network.lambdaSecurityGroup,
  databaseSecret: rds.secret,
  deadLetterQueues: messaging.workQueues.map((w) => w.dlq),
  dlqConfigJson: messaging.dlqConfigJson(),
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  providerSecrets: [secrets.paymentProviderSecret, secrets.shippingProviderSecret],
});

const workers = new WorkersStack(app, `Workers-${envConfig.name}`, {
  env,
  envConfig,
  vpc: network.vpc,
  securityGroup: network.lambdaSecurityGroup,
  workQueues: messaging.workQueues,
  eventBus: messaging.eventBus,
  catalogTable: database.catalogTable,
  idempotencyTable: database.idempotencyTable,
  databaseSecret: rds.secret,
  paymentFaultRate: Number(app.node.tryGetContext('paymentFaultRate') ?? 0),
});

new MonitoringStack(app, `Monitoring-${envConfig.name}`, {
  env,
  envConfig,
  apiFunction: api.apiFunction,
  httpApi: api.httpApi,
  workerFunctions: workers.workerFunctions,
  workQueues: messaging.workQueues,
  rdsInstance: rds.instance,
});

// Tag everything for cost allocation and ownership.
Tags.of(app).add('project', 'cloud-commerce');
Tags.of(app).add('environment', envConfig.name);
Tags.of(app).add('managed-by', 'cdk');

void storage;
