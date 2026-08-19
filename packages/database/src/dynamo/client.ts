import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '@cloud-commerce/config';

let cached: DynamoDBDocumentClient | undefined;

/**
 * Shared DynamoDB Document client. One instance per warm Lambda container so the
 * underlying HTTP connection pool is reused across invocations.
 *
 * `DYNAMODB_ENDPOINT` points this at DynamoDB Local for integration tests.
 */
export function getDocumentClient(): DynamoDBDocumentClient {
  if (cached) return cached;

  const config = getConfig();
  const base = new DynamoDBClient({
    region: config.region,
    ...(config.dynamodb.endpoint
      ? {
          endpoint: config.dynamodb.endpoint,
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {}),
  });

  cached = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
  return cached;
}

/** Test helper. */
export function resetDocumentClient(): void {
  cached = undefined;
}
