import * as path from 'node:path';

import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { functionLogGroup, lambdaDefaults, REPO_ROOT } from '../lib/lambda-defaults';
import { resourceName, stackName } from '../lib/naming';
import { ROLES } from '../lib/roles';

export interface AuthStackProps extends StackProps {
  readonly envConfig: EnvConfig;
  readonly vpc: ec2.IVpc;
  readonly securityGroup: ec2.ISecurityGroup;
  readonly databaseSecret: secretsmanager.ISecret;
  readonly catalogTable: dynamodb.ITable;
}

/**
 * Cognito user pool (CLAUDE.md §8). Email sign-in, three groups
 * (CUSTOMER / OPERATIONS / ADMIN) whose names are the RBAC roles the API
 * expects. A PostConfirmation trigger adds new users to CUSTOMER and provisions
 * their customer row.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, { ...props, stackName: stackName('Auth', props.envConfig.name) });
    const env = props.envConfig;

    const triggerName = resourceName('post-confirmation', env.name);
    const postConfirmation = new NodejsFunction(this, 'PostConfirmation', {
      ...lambdaDefaults(env),
      functionName: triggerName,
      logGroup: functionLogGroup(this, triggerName, env),
      entry: path.join(REPO_ROOT, 'apps/workers/src/auth/post-confirmation.ts'),
      handler: 'handler',
      description: 'Cognito post-confirmation: provision customer + assign group',
      timeout: Duration.seconds(20),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.securityGroup],
      environment: {
        ...lambdaDefaults(env).environment,
        DATABASE_SECRET_ARN: props.databaseSecret.secretArn,
        CATALOG_TABLE_NAME: props.catalogTable.tableName,
      },
    });
    props.databaseSecret.grantRead(postConfirmation);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: resourceName('users', env.name),
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: env.name === 'production' ? cognito.Mfa.OPTIONAL : cognito.Mfa.OFF,
      lambdaTriggers: { postConfirmation },
      removalPolicy: env.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      deletionProtection: env.retainData,
    });

    // The trigger needs to add users to a group.
    postConfirmation.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminAddUserToGroup'],
        resources: [this.userPool.userPoolArn],
      }),
    );

    // Groups — names match the RBAC roles (packages/auth ROLES).
    ROLES.forEach((role, i) => {
      new cognito.CfnUserPoolGroup(this, `${role}Group`, {
        userPoolId: this.userPool.userPoolId,
        groupName: role,
        precedence: i + 1, // ADMIN(1) wins over OPERATIONS(2) wins over CUSTOMER(3)
        description: `cloud-commerce ${role} role`,
      });
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: resourceName('web', env.name),
      authFlows: { userSrp: true },
      generateSecret: false, // public SPA client
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
