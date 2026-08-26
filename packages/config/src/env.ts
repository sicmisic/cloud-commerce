import { z } from 'zod';

/**
 * Central environment contract for every Lambda / process in the system.
 *
 * Rules (see CLAUDE.md §8):
 *  - This module never holds a *secret value*, only the ARN / name of the secret.
 *    Credential resolution happens at runtime through Secrets Manager.
 *  - Every consumer imports the typed `config` object; nothing reads `process.env`
 *    directly outside this file.
 */

export const STAGES = ['dev', 'staging', 'production', 'test'] as const;
export type Stage = (typeof STAGES)[number];

const optionalArn = z
  .string()
  .regex(/^arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{0,12}:.+$/, 'must be a valid AWS ARN')
  .optional();

/**
 * `.default()` values keep local unit tests and `cdk synth` runnable without a
 * populated environment. Real deployments inject every value via CDK.
 */
export const envSchema = z.object({
  STAGE: z.enum(STAGES).default('dev'),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  SERVICE_NAME: z.string().min(1).default('cloud-commerce'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- DynamoDB -----------------------------------------------------------
  CATALOG_TABLE_NAME: z.string().min(1).default('cloud-commerce-catalog-dev'),
  IDEMPOTENCY_TABLE_NAME: z.string().min(1).default('cloud-commerce-idempotency-dev'),
  DYNAMODB_ENDPOINT: z.string().url().optional(), // set for local DynamoDB

  // --- PostgreSQL -------------------------------------------------------------
  DATABASE_SECRET_ARN: optionalArn,
  DATABASE_URL: z.string().optional(), // used only for local/integration tests
  DATABASE_MAX_POOL: z.coerce.number().int().positive().max(50).default(5),

  // --- Messaging ------------------------------------------------------------
  EVENT_BUS_NAME: z.string().min(1).default('cloud-commerce-events-dev'),
  PAYMENT_QUEUE_URL: z.string().url().optional(),
  EMAIL_QUEUE_URL: z.string().url().optional(),
  SHIPPING_QUEUE_URL: z.string().url().optional(),
  INVENTORY_QUEUE_URL: z.string().url().optional(),
  /**
   * JSON array of `{ name, dlqUrl, dlqArn }` for the admin failed-events
   * endpoints. Injected by the messaging stack.
   */
  DLQ_QUEUES: z
    .string()
    .default('[]')
    .transform((raw, ctx) => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) throw new Error('not an array');
        return parsed as { name: string; dlqUrl: string; dlqArn: string }[];
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DLQ_QUEUES must be a JSON array' });
        return z.NEVER;
      }
    }),

  // --- Auth (Cognito) -----------------------------------------------------
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  // When true the JWT middleware trusts an unsigned `x-debug-claims` header.
  // Guard-railed: only honoured when STAGE !== 'production'.
  AUTH_ALLOW_DEBUG_CLAIMS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // --- External providers ------------------------------------------------
  PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  SHIPPING_PROVIDER: z.enum(['mock', 'easypost']).default('mock'),
  EMAIL_PROVIDER: z.enum(['mock', 'ses']).default('mock'),
  PAYMENT_SECRET_ARN: optionalArn,
  SHIPPING_SECRET_ARN: optionalArn,
  // Injected fault rate for the deliberate failure scenario (CLAUDE.md §7).
  PAYMENT_MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),

  // --- HTTP --------------------------------------------------------------
  CORS_ALLOWED_ORIGINS: z.string().default('*'),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
});

export type Env = z.infer<typeof envSchema>;
