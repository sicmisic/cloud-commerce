import { getConfig } from '@cloud-commerce/config';
import { DependencyFailureError } from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';
import { Pool, type PoolClient } from 'pg';

import { getSecretJson } from '../secrets';

const log = logger('PostgresPool');

let pool: Pool | undefined;

/** Shape of the RDS-managed secret (CLAUDE.md §8 — resolved at runtime by ARN). */
interface DbSecret {
  username: string;
  password: string;
  host: string;
  port: number;
  dbname: string;
}

async function buildPool(): Promise<Pool> {
  const config = getConfig();

  const common = {
    max: config.postgres.maxPool,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    // Lambda: keep the pool small and let connections recycle.
    allowExitOnIdle: true,
  };

  if (config.postgres.url) {
    return new Pool({ connectionString: config.postgres.url, ...common });
  }

  if (!config.postgres.secretArn) {
    throw new DependencyFailureError(
      'postgres',
      'neither DATABASE_URL nor DATABASE_SECRET_ARN is configured',
    );
  }

  const secret = await getSecretJson<DbSecret>(config.postgres.secretArn);
  return new Pool({
    host: secret.host,
    port: secret.port,
    user: secret.username,
    password: secret.password,
    database: secret.dbname,
    ssl: config.isProduction ? { rejectUnauthorized: true } : undefined,
    ...common,
  });
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = await buildPool();
    pool.on('error', (err) => log.error({ err }, 'idle postgres client error'));
  }
  return pool;
}

/** Run `fn` inside a transaction. Commits on success, rolls back on any throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await getPool()).connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Test / shutdown helper. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
