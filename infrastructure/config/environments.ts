/**
 * Per-environment infrastructure configuration (CLAUDE.md §13 — dev/staging/
 * production are separate environments with separate config). Account ids come
 * from CDK context or env vars so nothing sensitive is committed.
 */

export type EnvName = 'dev' | 'staging' | 'production';

export interface EnvConfig {
  readonly name: EnvName;
  readonly account?: string;
  readonly region: string;
  /** Lambda memory (MB) — production gets more headroom. */
  readonly lambdaMemoryMb: number;
  readonly lambdaLogRetentionDays: number;
  /** DynamoDB point-in-time recovery. */
  readonly dynamoPitr: boolean;
  /** RDS instance size class (Phase 3). */
  readonly rdsInstanceClass: string;
  readonly rdsMultiAz: boolean;
  /** Removal policy for stateful resources. */
  readonly retainData: boolean;
  /** API Gateway stage throttle. */
  readonly apiThrottle: { rateLimit: number; burstLimit: number };
  /** SNS topic subscription for alarms (Phase 6). */
  readonly alarmEmail?: string;
}

const BASE = {
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
} as const;

export const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  dev: {
    ...BASE,
    name: 'dev',
    account: process.env.CDK_DEV_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT,
    lambdaMemoryMb: 256,
    lambdaLogRetentionDays: 7,
    dynamoPitr: false,
    rdsInstanceClass: 'db.t4g.micro',
    rdsMultiAz: false,
    retainData: false,
    apiThrottle: { rateLimit: 50, burstLimit: 100 },
    alarmEmail: process.env.ALARM_EMAIL,
  },
  staging: {
    ...BASE,
    name: 'staging',
    account: process.env.CDK_STAGING_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT,
    lambdaMemoryMb: 512,
    lambdaLogRetentionDays: 30,
    dynamoPitr: true,
    rdsInstanceClass: 'db.t4g.small',
    rdsMultiAz: false,
    retainData: true,
    apiThrottle: { rateLimit: 100, burstLimit: 200 },
    alarmEmail: process.env.ALARM_EMAIL,
  },
  production: {
    ...BASE,
    name: 'production',
    account: process.env.CDK_PROD_ACCOUNT ?? process.env.CDK_DEFAULT_ACCOUNT,
    lambdaMemoryMb: 1024,
    lambdaLogRetentionDays: 90,
    dynamoPitr: true,
    rdsInstanceClass: 'db.r6g.large',
    rdsMultiAz: true,
    retainData: true,
    apiThrottle: { rateLimit: 200, burstLimit: 400 },
    alarmEmail: process.env.ALARM_EMAIL,
  },
};

export function resolveEnv(name: string | undefined): EnvConfig {
  const key = (name ?? 'dev') as EnvName;
  const config = ENVIRONMENTS[key];
  if (!config) {
    throw new Error(`Unknown environment '${name}'. Expected one of: dev, staging, production`);
  }
  return config;
}
