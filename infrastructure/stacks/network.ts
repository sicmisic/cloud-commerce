import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { stackName } from '../lib/naming';

export interface NetworkStackProps extends StackProps {
  readonly envConfig: EnvConfig;
}

/**
 * VPC for the compute that needs private networking (RDS + the Lambdas that talk
 * to it). No NAT gateway — outbound AWS API calls go through VPC endpoints
 * instead (gateway endpoints for S3/DynamoDB are free; interface endpoints for
 * Secrets Manager / EventBridge / SQS keep the traffic on the AWS backbone).
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  /** Shared SG for every Lambda that runs in the VPC; RDS allows ingress from it. */
  readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, { ...props, stackName: stackName('Network', props.envConfig.name) });

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Free gateway endpoints.
    this.vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
    this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // Interface endpoints for the services the Lambdas call from inside the VPC.
    for (const [name, service] of [
      ['SecretsManager', ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      ['EventBridge', ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE],
      ['Sqs', ec2.InterfaceVpcEndpointAwsService.SQS],
      ['CloudWatchLogs', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
    ] as const) {
      this.vpc.addInterfaceEndpoint(`${name}Endpoint`, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      });
    }

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'cloud-commerce VPC lambdas (api + workers)',
      allowAllOutbound: true,
    });
  }
}
