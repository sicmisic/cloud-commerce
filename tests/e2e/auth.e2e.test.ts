import { __resetContainer, __setContainer, handler, setTokenVerifier } from '@cloud-commerce/api';
import { FakeTokenVerifier } from '@cloud-commerce/auth';
import { CatalogService, InMemoryProductRepository } from '@cloud-commerce/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeContext, makeEvent, parseJsonBody } from '../helpers/api-gateway';

/** Bearer token = base64url(JSON claims), verified by the FakeTokenVerifier. */
function bearer(claims: Record<string, unknown>): Record<string, string> {
  const token = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { authorization: `Bearer ${token}` };
}

describe('E2E: authentication & RBAC through the handler', () => {
  beforeEach(() => {
    const repo = new InMemoryProductRepository();
    __setContainer({ productRepository: repo, catalogService: new CatalogService(repo) });
    setTokenVerifier(new FakeTokenVerifier());
  });

  afterEach(() => {
    __resetContainer();
    setTokenVerifier(undefined);
  });

  const createBody = {
    sku: 'auth-widget',
    name: 'Auth Widget',
    description: 'x',
    category: 'c',
    price: { amount: 100, currency: 'USD' },
    initialStock: 1,
  };

  it('401 with no Authorization header on a protected route', async () => {
    const res = await handler(makeEvent('POST', '/products', { body: createBody }), makeContext());
    expect(res.statusCode).toBe(401);
  });

  it('401 when the Authorization header is malformed', async () => {
    const res = await handler(
      makeEvent('POST', '/products', { headers: { authorization: 'Token abc' }, body: createBody }),
      makeContext(),
    );
    expect(res.statusCode).toBe(401);
  });

  it('403 when the token lacks the required permission (CUSTOMER creating a product)', async () => {
    const res = await handler(
      makeEvent('POST', '/products', {
        headers: bearer({ sub: 'c1', 'cognito:groups': ['CUSTOMER'] }),
        body: createBody,
      }),
      makeContext(),
    );
    expect(res.statusCode).toBe(403);
    expect(parseJsonBody<{ type: string }>(res.body as string).type).toBe('forbidden');
  });

  it('201 when an OPERATIONS token is presented', async () => {
    const res = await handler(
      makeEvent('POST', '/products', {
        headers: bearer({ sub: 'o1', 'cognito:groups': ['OPERATIONS'] }),
        body: createBody,
      }),
      makeContext(),
    );
    expect(res.statusCode).toBe(201);
  });

  it('an invalid bearer token is 401 (not 500)', async () => {
    const res = await handler(
      makeEvent('GET', '/products', { headers: { authorization: 'Bearer @@notjson@@' } }),
      makeContext(),
    );
    expect(res.statusCode).toBe(401);
  });
});
