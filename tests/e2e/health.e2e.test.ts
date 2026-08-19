import { handler } from '@cloud-commerce/api';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeContext, makeEvent, parseJsonBody } from '../helpers/api-gateway';

/**
 * Phase 1 end-to-end proof: an API Gateway event goes through the full pipeline
 * (context -> cors -> error handler -> auth -> rate limit -> router -> controller)
 * and comes back as a well-formed HTTP response with a correlation id.
 */
describe('E2E: health route through the Lambda handler', () => {
  beforeAll(() => {
    process.env.STAGE = 'test';
  });

  it('GET /health returns 200 with an ok body and correlation id', async () => {
    const res = await handler(makeEvent('GET', '/health'), makeContext());
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<{ status: string; version: string }>(res.body as string);
    expect(body.status).toBe('ok');
    expect(body.version).toBeTypeOf('string');
    expect(res.headers?.['x-correlation-id']).toBeTruthy();
  });

  it('propagates an inbound x-correlation-id', async () => {
    const res = await handler(
      makeEvent('GET', '/health', { headers: { 'x-correlation-id': 'trace-abc' } }),
      makeContext(),
    );
    expect(res.headers?.['x-correlation-id']).toBe('trace-abc');
  });

  it('GET /health/ready reports configured dependencies', async () => {
    const res = await handler(makeEvent('GET', '/health/ready'), makeContext());
    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<{ checks: Record<string, boolean> }>(res.body as string);
    expect(body.checks).toHaveProperty('catalogTable', true);
  });

  it('unknown route returns an RFC7807 problem document', async () => {
    const res = await handler(makeEvent('GET', '/does-not-exist'), makeContext());
    expect(res.statusCode).toBe(404);
    expect(res.headers?.['content-type']).toContain('problem+json');
    const body = parseJsonBody<{ type: string; correlationId: string }>(res.body as string);
    expect(body.type).toBe('not-found');
    expect(body.correlationId).toBeTruthy();
  });

  it('OPTIONS preflight short-circuits with CORS headers', async () => {
    const res = await handler(
      makeEvent('OPTIONS', '/health', { headers: { origin: 'https://shop.example' } }),
      makeContext(),
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers?.['access-control-allow-methods']).toContain('GET');
  });
});
