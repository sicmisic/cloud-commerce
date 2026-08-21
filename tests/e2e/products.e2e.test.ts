import { __resetContainer, __setContainer, handler } from '@cloud-commerce/api';
import { CatalogService, InMemoryProductRepository } from '@cloud-commerce/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeContext, makeEvent, parseJsonBody } from '../helpers/api-gateway';

const opsClaims = JSON.stringify({
  sub: 'cust_ops',
  'cognito:groups': ['OPERATIONS'],
  email: 'ops@example.com',
});

function opsHeaders() {
  return { 'x-debug-claims': opsClaims };
}

describe('E2E: catalog routes', () => {
  beforeEach(() => {
    const repo = new InMemoryProductRepository();
    __setContainer({ productRepository: repo, catalogService: new CatalogService(repo) });
  });

  afterEach(() => __resetContainer());

  async function createSample(overrides: Record<string, unknown> = {}) {
    return handler(
      makeEvent('POST', '/products', {
        headers: opsHeaders(),
        body: {
          sku: 'e2e-widget',
          name: 'E2E Widget',
          description: 'A widget for the e2e test',
          category: 'gadgets',
          price: { amount: 1999, currency: 'USD' },
          initialStock: 5,
          ...overrides,
        },
      }),
      makeContext(),
    );
  }

  it('rejects an anonymous create with 401', async () => {
    const res = await handler(
      makeEvent('POST', '/products', { body: { sku: 'x-1' } }),
      makeContext(),
    );
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid create body with 422 and field issues', async () => {
    const res = await handler(
      makeEvent('POST', '/products', { headers: opsHeaders(), body: { sku: 'lc' } }),
      makeContext(),
    );
    expect(res.statusCode).toBe(422);
    const body = parseJsonBody<{ issues: { path: string }[] }>(res.body as string);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('creates, reads, lists, updates, adjusts stock, and archives a product', async () => {
    const createRes = await createSample();
    expect(createRes.statusCode).toBe(201);
    const product = parseJsonBody<{ id: string; sku: string; price: { display: string } }>(
      createRes.body as string,
    );
    expect(product.sku).toBe('E2E-WIDGET');
    expect(product.price.display).toBe('$19.99');

    const getRes = await handler(makeEvent('GET', `/products/${product.id}`), makeContext());
    expect(getRes.statusCode).toBe(200);

    const bySku = await handler(makeEvent('GET', '/products/by-sku/E2E-WIDGET'), makeContext());
    expect(parseJsonBody<{ id: string }>(bySku.body as string).id).toBe(product.id);

    const listRes = await handler(
      makeEvent('GET', '/products', { query: { category: 'gadgets' } }),
      makeContext(),
    );
    const list = parseJsonBody<{ items: unknown[]; nextCursor: string | null }>(
      listRes.body as string,
    );
    expect(list.items).toHaveLength(1);
    expect(list.nextCursor).toBeNull();

    const patchRes = await handler(
      makeEvent('PATCH', `/products/${product.id}`, {
        headers: opsHeaders(),
        body: { name: 'Renamed Widget' },
      }),
      makeContext(),
    );
    expect(parseJsonBody<{ name: string; version: number }>(patchRes.body as string).name).toBe(
      'Renamed Widget',
    );

    const adjustRes = await handler(
      makeEvent('POST', `/products/${product.id}/inventory/adjust`, {
        headers: opsHeaders(),
        body: { delta: 10, reason: 'restock' },
      }),
      makeContext(),
    );
    expect(
      parseJsonBody<{ inventory: { available: number } }>(adjustRes.body as string).inventory
        .available,
    ).toBe(15);

    const archiveRes = await handler(
      makeEvent('DELETE', `/products/${product.id}`, { headers: opsHeaders() }),
      makeContext(),
    );
    expect(archiveRes.statusCode).toBe(204);

    const afterArchive = await handler(makeEvent('GET', `/products/${product.id}`), makeContext());
    expect(parseJsonBody<{ status: string }>(afterArchive.body as string).status).toBe('archived');
  });

  it('409s on a duplicate SKU', async () => {
    await createSample();
    const dupe = await createSample();
    expect(dupe.statusCode).toBe(409);
    expect(parseJsonBody<{ type: string }>(dupe.body as string).type).toBe('conflict');
  });

  it('409s when reserving more than available (via a low-stock product)', async () => {
    const createRes = await createSample({ sku: 'low-stock', initialStock: 1 });
    const { id } = parseJsonBody<{ id: string }>(createRes.body as string);
    // negative adjust below zero -> insufficient inventory
    const res = await handler(
      makeEvent('POST', `/products/${id}/inventory/adjust`, {
        headers: opsHeaders(),
        body: { delta: -5 },
      }),
      makeContext(),
    );
    expect(res.statusCode).toBe(409);
    expect(parseJsonBody<{ type: string }>(res.body as string).type).toBe('insufficient-inventory');
  });
});
