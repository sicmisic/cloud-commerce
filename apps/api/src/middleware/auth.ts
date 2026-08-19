import {
  FakeTokenVerifier,
  CognitoTokenVerifier,
  type TokenVerifier,
  type Principal,
} from '@cloud-commerce/auth';
import { getConfig } from '@cloud-commerce/config';
import { UnauthorizedError } from '@cloud-commerce/domain';
import { getLogger, patchContext } from '@cloud-commerce/logging';

import { type HttpRequest, type Middleware } from '../http/types';

let verifier: TokenVerifier | undefined;

function getVerifier(): TokenVerifier {
  if (verifier) return verifier;
  const { auth } = getConfig();
  if (auth.userPoolId && auth.clientId) {
    verifier = new CognitoTokenVerifier({ userPoolId: auth.userPoolId, clientId: auth.clientId });
  } else {
    // No pool configured (local/test) — fall back to the fake verifier.
    verifier = new FakeTokenVerifier();
  }
  return verifier;
}

/** Test seam. */
export function setTokenVerifier(v: TokenVerifier | undefined): void {
  verifier = v;
}

/**
 * Attaches `req.principal` when a valid credential is present. Does NOT reject
 * anonymous requests — routes opt into protection with {@link requireAuth}.
 */
export const withAuth: Middleware = (next) => async (req) => {
  const principal = await resolvePrincipal(req);
  if (principal) {
    req.principal = principal;
    patchContext({ userId: principal.userId, role: principal.roles.join(',') });
    getLogger().debug({ userId: principal.userId, roles: principal.roles }, 'authenticated');
  }
  return next(req);
};

async function resolvePrincipal(req: HttpRequest): Promise<Principal | undefined> {
  const { auth } = getConfig();

  const debugClaims = req.headers['x-debug-claims'];
  if (debugClaims && auth.allowDebugClaims) {
    return new FakeTokenVerifier().verify(Buffer.from(debugClaims, 'utf8').toString('base64url'));
  }

  const header = req.headers['authorization'];
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedError('Authorization header must be "Bearer <token>"');
  }
  return getVerifier().verify(token);
}

/** Route-level guard — throws 401 unless {@link withAuth} attached a principal. */
export function requireAuth(req: HttpRequest): Principal {
  if (!req.principal) throw new UnauthorizedError();
  return req.principal;
}
