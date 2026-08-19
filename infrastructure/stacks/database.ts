import { Stack, type StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { type Construct } from 'constructs';

import { type EnvConfig } from '../config/environments';
import { resourceName, stackName } from '../lib/naming';

export interface DatabaseStackProps extends StackProps {
  readonly envConfig: EnvConfig;
}

/**
 * DynamoDB for the product catalog + idempotency records (CLAUDE.md §2).
 * PostgreSQL/RDS is added in Phase 3 as `RdsStack`.
 *
 * Catalog GSIs are added in Phase 2 once access patterns are documented in
 * docs/database.md (CLAUDE.md §4).
 */
export class DatabaseStack extends Stack {
  readonly catalogTable: dynamodb.Table;
  readonly idempotencyTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, { ...props, stackName: stackName('Database', props.envConfig.name) });
    const env = props.envConfig;

    this.catalogTable = new dynamodb.Table(this, 'CatalogTable', {
      tableName: resourceName('catalog', env.name),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: env.dynamoPitr },
      removalPolicy: env.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      deletionProtection: env.retainData,
    });

    // GSI1 — list/query products by category and by status (Phase 2 patterns 2 & 4).
    this.catalogTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2 — find product by SKU (Phase 2 pattern 3).
    this.catalogTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      tableName: resourceName('idempotency', env.name),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY, // records are transient by design
    });
  }

  /** Number of seconds an idempotency record lives — mirrors the app default. */
  static readonly idempotencyTtl = Duration.days(1);
}
