import { envSchema, type Env, type Stage } from './env';

export { envSchema, STAGES } from './env';
export type { Env, Stage } from './env';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Structured, immutable view of the environment. Grouped by concern so call
 * sites read `config.dynamodb.catalogTableName` rather than a flat bag of
 * `process.env` strings.
 */
export interface AppConfig {
  readonly stage: Stage;
  readonly region: string;
  readonly serviceName: string;
  readonly logLevel: Env['LOG_LEVEL'];
  readonly isProduction: boolean;
  readonly dynamodb: {
    readonly catalogTableName: string;
    readonly idempotencyTableName: string;
    readonly endpoint?: string;
    readonly idempotencyTtlSeconds: number;
  };
  readonly postgres: {
    readonly secretArn?: string;
    readonly url?: string;
    readonly maxPool: number;
  };
  readonly messaging: {
    readonly eventBusName: string;
    readonly paymentQueueUrl?: string;
    readonly emailQueueUrl?: string;
    readonly shippingQueueUrl?: string;
    readonly inventoryQueueUrl?: string;
  };
  readonly auth: {
    readonly userPoolId?: string;
    readonly clientId?: string;
    readonly allowDebugClaims: boolean;
  };
  readonly providers: {
    readonly payment: Env['PAYMENT_PROVIDER'];
    readonly shipping: Env['SHIPPING_PROVIDER'];
    readonly email: Env['EMAIL_PROVIDER'];
    readonly paymentSecretArn?: string;
    readonly shippingSecretArn?: string;
    readonly paymentMockFailureRate: number;
  };
  readonly http: {
    readonly corsAllowedOrigins: string[];
    readonly rateLimitPerMinute: number;
  };
}

function shape(env: Env): AppConfig {
  return {
    stage: env.STAGE,
    region: env.AWS_REGION,
    serviceName: env.SERVICE_NAME,
    logLevel: env.LOG_LEVEL,
    isProduction: env.STAGE === 'production',
    dynamodb: {
      catalogTableName: env.CATALOG_TABLE_NAME,
      idempotencyTableName: env.IDEMPOTENCY_TABLE_NAME,
      endpoint: env.DYNAMODB_ENDPOINT,
      idempotencyTtlSeconds: env.IDEMPOTENCY_TTL_SECONDS,
    },
    postgres: {
      secretArn: env.DATABASE_SECRET_ARN,
      url: env.DATABASE_URL,
      maxPool: env.DATABASE_MAX_POOL,
    },
    messaging: {
      eventBusName: env.EVENT_BUS_NAME,
      paymentQueueUrl: env.PAYMENT_QUEUE_URL,
      emailQueueUrl: env.EMAIL_QUEUE_URL,
      shippingQueueUrl: env.SHIPPING_QUEUE_URL,
      inventoryQueueUrl: env.INVENTORY_QUEUE_URL,
    },
    auth: {
      userPoolId: env.COGNITO_USER_POOL_ID,
      clientId: env.COGNITO_CLIENT_ID,
      // Debug claims can never be honoured in production, regardless of the flag.
      allowDebugClaims: env.AUTH_ALLOW_DEBUG_CLAIMS && env.STAGE !== 'production',
    },
    providers: {
      payment: env.PAYMENT_PROVIDER,
      shipping: env.SHIPPING_PROVIDER,
      email: env.EMAIL_PROVIDER,
      paymentSecretArn: env.PAYMENT_SECRET_ARN,
      shippingSecretArn: env.SHIPPING_SECRET_ARN,
      paymentMockFailureRate: env.PAYMENT_MOCK_FAILURE_RATE,
    },
    http: {
      corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      rateLimitPerMinute: env.API_RATE_LIMIT_PER_MINUTE,
    },
  };
}

/**
 * Parse an arbitrary source (defaults to `process.env`). Throws {@link ConfigError}
 * with a readable, aggregated message when validation fails — fail fast at cold
 * start rather than 500 later.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${issues}`);
  }
  return Object.freeze(shape(parsed.data));
}

let cached: AppConfig | undefined;

/** Memoised config for the lifetime of the process (Lambda warm container). */
export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

/** Test helper — drop the memoised instance. */
export function resetConfigCache(): void {
  cached = undefined;
}
