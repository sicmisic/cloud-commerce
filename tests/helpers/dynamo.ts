import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Helpers for integration tests that run against DynamoDB Local
 * (`docker compose up dynamodb`). When `DYNAMODB_ENDPOINT` is unset the suites
 * that use these skip themselves.
 */

export const dynamoEndpoint = process.env.DYNAMODB_ENDPOINT;
export const dynamoAvailable = Boolean(dynamoEndpoint);

export function makeRawClient(): DynamoDBClient {
  return new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: dynamoEndpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
}

export function makeDocClient(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(makeRawClient(), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/** Create the `catalog` table with the three GSIs the repository expects. */
export async function createCatalogTable(client: DynamoDBClient, tableName: string): Promise<void> {
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI3PK', AttributeType: 'S' },
        { AttributeName: 'GSI3SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [{ AttributeName: 'GSI2PK', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI3',
          KeySchema: [
            { AttributeName: 'GSI3PK', KeyType: 'HASH' },
            { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 30, minDelay: 1 }, { TableName: tableName });
}

export async function dropTable(client: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch {
    /* already gone */
  }
}

export function uniqueTableName(prefix = 'catalog-it'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}
