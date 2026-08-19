import { UnauthorizedError } from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

import { type Principal, type Role, isRole, principalFrom } from './roles';

const log = logger('TokenVerifier');

/**
 * Port for turning a bearer token into a {@link Principal}. The Cognito adapter
 * ({@link CognitoTokenVerifier}) validates signature, issuer, audience and
 * expiry; tests use {@link FakeTokenVerifier}.
 */
export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

interface CognitoVerifierDeps {
  userPoolId: string;
  clientId: string;
  /** Injected for tests; defaults to aws-jwt-verify at runtime. */
  jwtVerifier?: { verify(token: string): Promise<Record<string, unknown>> };
}

export class CognitoTokenVerifier implements TokenVerifier {
  private verifierPromise: Promise<{ verify(token: string): Promise<Record<string, unknown>> }>;

  constructor(deps: CognitoVerifierDeps) {
    this.verifierPromise = deps.jwtVerifier
      ? Promise.resolve(deps.jwtVerifier)
      : import('aws-jwt-verify').then(({ CognitoJwtVerifier }) =>
          CognitoJwtVerifier.create({
            userPoolId: deps.userPoolId,
            clientId: deps.clientId,
            tokenUse: 'id',
          }),
        );
  }

  async verify(token: string): Promise<Principal> {
    let claims: Record<string, unknown>;
    try {
      const verifier = await this.verifierPromise;
      claims = await verifier.verify(token);
    } catch (err) {
      log.warn({ err }, 'token verification failed');
      throw new UnauthorizedError('Invalid or expired token');
    }
    return claimsToPrincipal(claims);
  }
}

/** Test/local verifier — trusts a JSON-encoded claims blob as the "token". */
export class FakeTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<Principal> {
    try {
      const claims = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      return claimsToPrincipal(claims);
    } catch {
      throw new UnauthorizedError('Invalid debug claims token');
    }
  }
}

export function claimsToPrincipal(claims: Record<string, unknown>): Principal {
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!sub) throw new UnauthorizedError('Token is missing "sub" claim');

  const groups = claims['cognito:groups'];
  const roles: Role[] = Array.isArray(groups)
    ? groups.filter((g): g is string => typeof g === 'string').filter(isRole)
    : [];

  // Every authenticated user is at least a CUSTOMER.
  if (roles.length === 0) roles.push('CUSTOMER');

  const email = typeof claims.email === 'string' ? claims.email : undefined;
  return principalFrom(sub, roles, email);
}
