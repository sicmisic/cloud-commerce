import { Stack, type StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { resourceName, stackName } from '../lib/naming';

export interface SecretsStackProps extends StackProps {
  readonly envConfig: EnvConfig;
}

/**
 * Placeholder secrets for the external providers (CLAUDE.md §8 — every
 * credential lives in Secrets Manager and is referenced by ARN). The values are
 * created empty and populated out-of-band; nothing sensitive is in CDK.
 */
export class SecretsStack extends Stack {
  readonly paymentProviderSecret: secretsmanager.Secret;
  readonly shippingProviderSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, { ...props, stackName: stackName('Secrets', props.envConfig.name) });
    const env = props.envConfig;

    const common: secretsmanager.SecretProps = {
      removalPolicy: env.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    };

    this.paymentProviderSecret = new secretsmanager.Secret(this, 'PaymentProviderSecret', {
      ...common,
      secretName: resourceName('payment-provider', env.name),
      description: 'API credentials for the payment provider (Stripe)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ configured: false }),
        generateStringKey: 'placeholder',
      },
    });

    this.shippingProviderSecret = new secretsmanager.Secret(this, 'ShippingProviderSecret', {
      ...common,
      secretName: resourceName('shipping-provider', env.name),
      description: 'API credentials for the shipping provider (EasyPost)',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ configured: false }),
        generateStringKey: 'placeholder',
      },
    });

    new CfnOutput(this, 'PaymentProviderSecretArn', {
      value: this.paymentProviderSecret.secretArn,
    });
    new CfnOutput(this, 'ShippingProviderSecretArn', {
      value: this.shippingProviderSecret.secretArn,
    });
  }
}
