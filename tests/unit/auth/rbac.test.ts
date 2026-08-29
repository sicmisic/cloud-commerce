import { permissionsFor, principalFrom, requirePermission } from '@cloud-commerce/auth';
import { ForbiddenError } from '@cloud-commerce/domain';
import { describe, expect, it } from 'vitest';

describe('RBAC', () => {
  it('CUSTOMER can read the catalog and create/read own orders only', () => {
    const perms = permissionsFor(['CUSTOMER']);
    expect([...perms].sort()).toEqual(['catalog:read', 'order:create', 'order:read:own']);
  });

  it('OPERATIONS can write the catalog and manage any order + failed events', () => {
    const perms = permissionsFor(['OPERATIONS']);
    expect(perms.has('catalog:write')).toBe(true);
    expect(perms.has('order:cancel:any')).toBe(true);
    expect(perms.has('admin:failed-events:retry')).toBe(true);
    expect(perms.has('order:create')).toBe(false);
  });

  it('ADMIN is a superset', () => {
    const admin = permissionsFor(['ADMIN']);
    for (const p of [...permissionsFor(['CUSTOMER']), ...permissionsFor(['OPERATIONS'])]) {
      expect(admin.has(p)).toBe(true);
    }
  });

  it('requirePermission throws ForbiddenError listing the missing permissions', () => {
    const customer = principalFrom('u1', ['CUSTOMER']);
    expect(() => requirePermission(customer, 'catalog:write')).toThrow(ForbiddenError);
    expect(() => requirePermission(customer, 'catalog:read')).not.toThrow();
  });

  it('multi-role principals get the union', () => {
    const p = permissionsFor(['CUSTOMER', 'OPERATIONS']);
    expect(p.has('order:create')).toBe(true);
    expect(p.has('catalog:write')).toBe(true);
  });
});
