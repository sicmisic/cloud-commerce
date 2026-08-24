import { execSync } from 'node:child_process';

import { Pool } from 'pg';

/**
 * Helpers for integration tests against a real PostgreSQL
 * (`docker compose up postgres`). Suites self-skip when `DATABASE_URL` is unset.
 */

export const databaseUrl = process.env.DATABASE_URL;
export const postgresAvailable = Boolean(databaseUrl);

// Vitest runs from the repo root.
const repoRoot = process.cwd();

let migrated = false;

/** Apply migrations once per test process. */
export function ensureMigrated(): void {
  if (migrated || !databaseUrl) return;
  execSync('pnpm --filter @cloud-commerce/database run migrate:up', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  migrated = true;
}

export function makePool(): Pool {
  return new Pool({ connectionString: databaseUrl, max: 4 });
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE shipments, payments, order_items, orders, customers RESTART IDENTITY CASCADE',
  );
}
