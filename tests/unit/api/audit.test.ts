import { withAudit, type HttpRequest } from '@cloud-commerce/api';
import { principalFrom } from '@cloud-commerce/auth';
import { createRequestContext, getLogger, runWithContext } from '@cloud-commerce/logging';
import { afterEach, describe, expect, it, vi } from 'vitest';

function req(
  method: string,
  path: string,
  principal = principalFrom('u1', ['OPERATIONS']),
): HttpRequest {
  return {
    method,
    path,
    headers: {},
    query: {},
    params: {},
    body: undefined,
    context: { ...createRequestContext({ route: `${method} ${path}` }) },
    principal,
  };
}

describe('withAudit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits one audit line for a successful mutation', async () => {
    const info = vi.spyOn(getLogger(), 'info');
    const wrapped = withAudit(async () => ({ statusCode: 201, headers: {}, body: '{}' }));
    await runWithContext(req('POST', '/products').context, () => wrapped(req('POST', '/products')));

    const auditCall = info.mock.calls.find((c) => (c[0] as { audit?: boolean }).audit);
    expect(auditCall).toBeTruthy();
    expect((auditCall![0] as { outcome: string }).outcome).toBe('success');
  });

  it('does not audit GET requests', async () => {
    const info = vi.spyOn(getLogger(), 'info');
    const wrapped = withAudit(async () => ({ statusCode: 200, headers: {}, body: '[]' }));
    await runWithContext(req('GET', '/products').context, () => wrapped(req('GET', '/products')));
    expect(info.mock.calls.some((c) => (c[0] as { audit?: boolean }).audit)).toBe(false);
  });

  it('logs an error outcome and rethrows', async () => {
    const warn = vi.spyOn(getLogger(), 'warn');
    const wrapped = withAudit(async () => {
      throw new Error('boom');
    });
    await expect(
      runWithContext(req('DELETE', '/products/p1').context, () =>
        wrapped(req('DELETE', '/products/p1')),
      ),
    ).rejects.toThrow('boom');
    expect(warn.mock.calls.some((c) => (c[0] as { outcome?: string }).outcome === 'error')).toBe(
      true,
    );
  });
});
