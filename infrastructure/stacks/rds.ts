import { Stack, type StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { resourceName, stackName } from '../lib/naming';

export interface RdsStackProps extends StackProps {
  readonly envConfig: EnvConfig;
  readonly vpc: ec2.IVpc;
  /** Shared Lambda SG (from NetworkStack) allowed to reach port 5432. */
  readonly appSecurityGroup: ec2.ISecurityGroup;
}

/**
 * PostgreSQL for transactional order data (ADR 002). Credentials are generated
 * into Secrets Manager (`Credentials.fromGeneratedSecret`) and referenced only
 * by ARN — nothing is in code or CDK context (CLAUDE.md §8).
 */
export class RdsStack extends Stack {
  readonly instance: rds.DatabaseInstance;
  readonly secret: secretsmanager.ISecret;
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, { ...props, stackName: stackName('Rds', props.envConfig.name) });
    const env = props.envConfig;

    this.securityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: props.vpc,
      description: 'cloud-commerce postgres - ingress only from the app security group',
      allowAllOutbound: false,
    });

    const [instanceClass, instanceSize] = parseInstanceClass(env.rdsInstanceClass);

    this.instance = new rds.DatabaseInstance(this, 'Postgres', {
      instanceIdentifier: resourceName('orders', env.name),
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.securityGroup],
      instanceType: ec2.InstanceType.of(instanceClass, instanceSize),
      multiAz: env.rdsMultiAz,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      databaseName: 'commerce',
      credentials: rds.Credentials.fromGeneratedSecret('commerce', {
        secretName: resourceName('db-credentials', env.name),
      }),
      backupRetention: env.retainData ? Duration.days(7) : Duration.days(1),
      deleteAutomatedBackups: !env.retainData,
      deletionProtection: env.retainData,
      removalPolicy: env.retainData ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ['postgresql'],
      enablePerformanceInsights: env.name === 'production',
    });

    this.secret = this.instance.secret!;

    this.securityGroup.addIngressRule(
      props.appSecurityGroup,
      ec2.Port.tcp(5432),
      'app lambdas -> postgres',
    );
  }
}

function parseInstanceClass(spec: string): [ec2.InstanceClass, ec2.InstanceSize] {
  // e.g. "db.t4g.micro" -> [BURSTABLE4_GRAVITON, MICRO]
  const [, family, size] = spec.split('.');
  const classMap: Record<string, ec2.InstanceClass> = {
    t4g: ec2.InstanceClass.BURSTABLE4_GRAVITON,
    t3: ec2.InstanceClass.BURSTABLE3,
    r6g: ec2.InstanceClass.MEMORY6_GRAVITON,
    m6g: ec2.InstanceClass.STANDARD6_GRAVITON,
  };
  const sizeMap: Record<string, ec2.InstanceSize> = {
    micro: ec2.InstanceSize.MICRO,
    small: ec2.InstanceSize.SMALL,
    medium: ec2.InstanceSize.MEDIUM,
    large: ec2.InstanceSize.LARGE,
  };
  return [
    classMap[family ?? 't4g'] ?? ec2.InstanceClass.BURSTABLE4_GRAVITON,
    sizeMap[size ?? 'micro'] ?? ec2.InstanceSize.MICRO,
  ];
}
