/**
 * Cognito group names — must match `ROLES` in `packages/auth/src/roles.ts`.
 * Kept as a local copy so the infra package does not depend on the runtime
 * auth package (and its JWT libraries).
 */
export const ROLES = ['CUSTOMER', 'OPERATIONS', 'ADMIN'] as const;
