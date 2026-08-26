import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  DependencyFailureError,
  type ClaimResult,
  type IdempotencyRecord,
  type IdempotencyStore,
} from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

import { getDocumentClient } from './client';

const log = logger('DynamoIdempotencyStore');

const pk = (key: string) => `IDEMPOTENCY#${key}`;

interface Item {
  PK: string;
  key: string;
  status: 'in_progress' | 'completed';
  requestHash: string;
  response?: unknown;
  createdAt: string;
  expiresAt: number;
}

/**
 * DynamoDB-backed idempotency store (ADR 004). `claim` is a conditional put:
 * the first caller wins and gets `claimed`; everyone else reads the existing
 * record and gets `completed` / `in_progress` / `mismatch`.
 */
export class DynamoIdempotencyStore implements IdempotencyStore {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? getDocumentClient();
  }

  async claim(key: string, requestHash: string, ttlSeconds: number): Promise<ClaimResult> {
    const now = new Date();
    const item: Item = {
      PK: pk(key),
      key,
      status: 'in_progress',
      requestHash,
      createdAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + ttlSeconds,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return { outcome: 'claimed' };
    } catch (err) {
      if (!isConditionFailed(err)) {
        log.error({ err, key }, 'idempotency claim failed');
        throw new DependencyFailureError('dynamodb', err);
      }
    }

    // Someone already holds the key — read it back.
    const existing = await this.get(key);
    if (!existing) {
      // Rare race: record expired between the put and the get. Treat as claimed.
      return { outcome: 'claimed' };
    }
    if (existing.requestHash !== requestHash) return { outcome: 'mismatch', record: existing };
    if (existing.status === 'completed') return { outcome: 'completed', record: existing };
    return { outcome: 'in_progress', record: existing };
  }

  async complete(key: string, response: unknown): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: pk(key) },
          UpdateExpression: 'SET #s = :completed, #r = :response',
          ExpressionAttributeNames: { '#s': 'status', '#r': 'response' },
          ExpressionAttributeValues: { ':completed': 'completed', ':response': response },
          ConditionExpression: 'attribute_exists(PK)',
        }),
      );
    } catch (err) {
      throw new DependencyFailureError('dynamodb', err);
    }
  }

  async release(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({ TableName: this.tableName, Key: { PK: pk(key) } }),
      );
    } catch (err) {
      throw new DependencyFailureError('dynamodb', err);
    }
  }

  private async get(key: string): Promise<IdempotencyRecord | null> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: pk(key) } }),
    );
    if (!result.Item) return null;
    const item = result.Item as Item;
    return {
      key: item.key,
      status: item.status,
      requestHash: item.requestHash,
      response: item.response,
      createdAt: item.createdAt,
    };
  }
}

function isConditionFailed(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'ConditionalCheckFailedException'
  );
}
