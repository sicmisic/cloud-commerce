import { ForbiddenError } from '@cloud-commerce/domain';

/**
 * RBAC model (CLAUDE.md §8). Roles map to Cognito groups. Permissions are
 * derived from role so handlers assert on a capability, not a role name.
 */
export const ROLES = ['CUSTOMER', 'OPERATIONS', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'catalog:read'
  | 'catalog:write'
  | 'order:create'
  | 'order:read:own'
  | 'order:read:any'
  | 'order:cancel:any'
  | 'admin:failed-events:read'
  | 'admin:failed-events:retry';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  CUSTOMER: ['catalog:read', 'order:create', 'order:read:own'],
  OPERATIONS: [
    'catalog:read',
    'catalog:write',
    'order:read:any',
    'order:cancel:any',
    'admin:failed-events:read',
    'admin:failed-events:retry',
  ],
  ADMIN: [
    'catalog:read',
    'catalog:write',
    'order:create',
    'order:read:own',
    'order:read:any',
    'order:cancel:any',
    'admin:failed-events:read',
    'admin:failed-events:retry',
  ],
};

export function permissionsFor(roles: Role[]): Set<Permission> {
  const perms = new Set<Permission>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) perms.add(p);
  }
  return perms;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export interface Principal {
  readonly userId: string;
  readonly email?: string;
  readonly roles: Role[];
  readonly permissions: Set<Permission>;
}

export function principalFrom(userId: string, roles: Role[], email?: string): Principal {
  return { userId, email, roles, permissions: permissionsFor(roles) };
}

/** Throw {@link ForbiddenError} unless the principal holds every listed permission. */
export function requirePermission(principal: Principal, ...required: Permission[]): void {
  const missing = required.filter((p) => !principal.permissions.has(p));
  if (missing.length > 0) {
    throw new ForbiddenError(`Missing permission(s): ${missing.join(', ')}`);
  }
}
