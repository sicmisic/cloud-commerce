/**
 * Global test setup. Silences structured logs unless a test explicitly wants
 * them (LOG_LEVEL=debug pnpm test) and pins a deterministic stage.
 */
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.STAGE = process.env.STAGE ?? 'test';
process.env.AUTH_ALLOW_DEBUG_CLAIMS = 'true';
