#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';

import { resolveEnv } from '../config/environments';
import { ApiStack } from '../stacks/api';
import { DatabaseStack } from '../stacks/database';
import { MessagingStack } from '../stacks/messaging';
import { MonitoringStack } from '../stacks/monitoring';
import { NetworkStack } from '../stacks/network';
import { RdsStack } from '../stacks/rds';
import { StorageStack } from '../stacks/storage';

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

const api = new ApiStack(app, `Api-${envConfig.name}`, {
  env,
  envConfig,
  catalogTable: database.catalogTable,
  idempotencyTable: database.idempotencyTable,
  eventBus: messaging.eventBus,
  vpc: network.vpc,
  securityGroup: network.lambdaSecurityGroup,
  databaseSecret: rds.secret,
});

new MonitoringStack(app, `Monitoring-${envConfig.name}`, {
  env,
  envConfig,
  apiFunctionName: api.apiFunction.functionName,
});

// Tag everything for cost allocation and ownership.
Tags.of(app).add('project', 'cloud-commerce');
Tags.of(app).add('environment', envConfig.name);
Tags.of(app).add('managed-by', 'cdk');

void storage;
