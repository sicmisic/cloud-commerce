import { CognitoTokenVerifier, FakeTokenVerifier, claimsToPrincipal } from '@cloud-commerce/auth';
import { UnauthorizedError } from '@cloud-commerce/domain';
import { describe, expect, it } from 'vitest';

describe('claimsToPrincipal', () => {
  it('maps cognito:groups to roles and derives permissions', () => {
    const p = claimsToPrincipal({ sub: 'u1', email: 'a@b.com', 'cognito:groups': ['OPERATIONS'] });
    expect(p.userId).toBe('u1');
    expect(p.roles).toEqual(['OPERATIONS']);
    expect(p.permissions.has('catalog:write')).toBe(true);
    expect(p.permissions.has('order:create')).toBe(false);
  });

  it('defaults to CUSTOMER when no groups are present', () => {
    const p = claimsToPrincipal({ sub: 'u2' });
    expect(p.roles).toEqual(['CUSTOMER']);
  });

  it('ignores unknown group names', () => {
    const p = claimsToPrincipal({ sub: 'u3', 'cognito:groups': ['SUPERUSER', 'ADMIN'] });
    expect(p.roles).toEqual(['ADMIN']);
  });

  it('rejects a token with no sub', () => {
    expect(() => claimsToPrincipal({ email: 'x@y.com' })).toThrow(UnauthorizedError);
  });
});

describe('CognitoTokenVerifier', () => {
  it('delegates to the injected jwt verifier and maps claims', async () => {
    const verifier = new CognitoTokenVerifier({
      userPoolId: 'pool',
      clientId: 'client',
      jwtVerifier: {
        verify: async (token: string) => {
          expect(token).toBe('good-token');
          return { sub: 'u9', 'cognito:groups': ['ADMIN'] };
        },
      },
    });
    const principal = await verifier.verify('good-token');
    expect(principal.roles).toEqual(['ADMIN']);
  });

  it('turns a verification failure into UnauthorizedError', async () => {
    const verifier = new CognitoTokenVerifier({
      userPoolId: 'pool',
      clientId: 'client',
      jwtVerifier: {
        verify: async () => {
          throw new Error('expired');
        },
      },
    });
    await expect(verifier.verify('bad')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('FakeTokenVerifier', () => {
  it('decodes a base64url JSON claims blob', async () => {
    const claims = Buffer.from(
      JSON.stringify({ sub: 'u1', 'cognito:groups': ['CUSTOMER'] }),
    ).toString('base64url');
    const p = await new FakeTokenVerifier().verify(claims);
    expect(p.userId).toBe('u1');
  });

  it('rejects garbage', async () => {
    await expect(new FakeTokenVerifier().verify('!!!not-base64!!!')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
