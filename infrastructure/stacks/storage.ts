import { Stack, type StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { resourceName, stackName } from '../lib/naming';

export interface StorageStackProps extends StackProps {
  readonly envConfig: EnvConfig;
}

/**
 * S3 = binary objects only (CLAUDE.md §2): product images, generated reports,
 * archived logs. All buckets are private, encrypted, versioned, and block all
 * public access; access is via presigned URLs / CloudFront (future).
 */
export class StorageStack extends Stack {
  readonly productImagesBucket: s3.Bucket;
  readonly reportsBucket: s3.Bucket;
  readonly logArchiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, { ...props, stackName: stackName('Storage', props.envConfig.name) });
    const env = props.envConfig;

    const common: s3.BucketProps = {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: env.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !env.retainData,
    };

    this.productImagesBucket = new s3.Bucket(this, 'ProductImages', {
      ...common,
      bucketName: resourceName('product-images', env.name),
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    this.reportsBucket = new s3.Bucket(this, 'Reports', {
      ...common,
      bucketName: resourceName('reports', env.name),
      lifecycleRules: [{ expiration: Duration.days(90) }],
    });

    this.logArchiveBucket = new s3.Bucket(this, 'LogArchive', {
      ...common,
      bucketName: resourceName('log-archive', env.name),
      lifecycleRules: [
        {
          transitions: [
            { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(30) },
          ],
        },
        { expiration: Duration.days(365) },
      ],
    });
  }
}
