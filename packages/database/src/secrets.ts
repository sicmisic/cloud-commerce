import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DependencyFailureError } from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

const log = logger('SecretsManager');

/**
 * Resolves secret *values* at runtime from their ARN (CLAUDE.md §8 — nothing is
 * hardcoded, config only ever holds the ARN). Values are cached for the life of
 * the container with a soft TTL so rotation is picked up without a redeploy.
 */

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
let client: SecretsManagerClient | undefined;

function getClient(): SecretsManagerClient {
  if (!client) client = new SecretsManagerClient({});
  return client;
}

export async function getSecretString(secretArn: string): Promise<string> {
  const cached = cache.get(secretArn);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const result = await getClient().send(new GetSecretValueCommand({ SecretId: secretArn }));
    const value = result.SecretString ?? '';
    if (!value) throw new Error('SecretString was empty');
    cache.set(secretArn, { value, fetchedAt: Date.now() });
    return value;
  } catch (err) {
    log.error({ err, secretArn }, 'failed to resolve secret');
    // Serve a stale value rather than fail hard if we ever had one.
    if (cached) {
      log.warn({ secretArn }, 'serving stale secret after fetch failure');
      return cached.value;
    }
    throw new DependencyFailureError('secretsmanager', err);
  }
}

export async function getSecretJson<T = Record<string, unknown>>(secretArn: string): Promise<T> {
  const raw = await getSecretString(secretArn);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new DependencyFailureError('secretsmanager', `secret ${secretArn} is not valid JSON`);
  }
}

/** Test helper. */
export function resetSecretsCache(): void {
  cache.clear();
  client = undefined;
}
