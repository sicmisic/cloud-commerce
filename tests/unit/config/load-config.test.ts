import { ConfigError, loadConfig } from '@cloud-commerce/config';
import { describe, expect, it } from 'vitest';

describe('loadConfig', () => {
  it('applies safe defaults for an empty environment', () => {
    const config = loadConfig({});
    expect(config.stage).toBe('dev');
    expect(config.region).toBe('us-east-1');
    expect(config.dynamodb.catalogTableName).toContain('catalog');
    expect(config.isProduction).toBe(false);
  });

  it('parses and groups values by concern', () => {
    const config = loadConfig({
      STAGE: 'production',
      AWS_REGION: 'eu-west-1',
      CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com',
      API_RATE_LIMIT_PER_MINUTE: '30',
    });
    expect(config.isProduction).toBe(true);
    expect(config.http.corsAllowedOrigins).toEqual(['https://a.com', 'https://b.com']);
    expect(config.http.rateLimitPerMinute).toBe(30);
  });

  it('never honours debug claims in production', () => {
    const config = loadConfig({ STAGE: 'production', AUTH_ALLOW_DEBUG_CLAIMS: 'true' });
    expect(config.auth.allowDebugClaims).toBe(false);
  });

  it('honours debug claims outside production when enabled', () => {
    const config = loadConfig({ STAGE: 'dev', AUTH_ALLOW_DEBUG_CLAIMS: 'true' });
    expect(config.auth.allowDebugClaims).toBe(true);
  });

  it('throws a readable ConfigError on invalid input', () => {
    expect(() => loadConfig({ STAGE: 'nonsense' })).toThrow(ConfigError);
    expect(() => loadConfig({ PAYMENT_MOCK_FAILURE_RATE: '5' })).toThrow(/failure/i);
  });
});
