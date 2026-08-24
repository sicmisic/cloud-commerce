/**
 * Pure domain layer — entities, value objects, domain errors, and ports.
 * No AWS SDK, no I/O, no framework imports. Everything here is unit-testable
 * in isolation (CLAUDE.md §3).
 *
 * Modules:
 *   - shared     (Phase 1)
 *   - product    (Phase 2)
 *   - customer   (Phase 3)
 *   - order      (Phase 3)
 */
export * from './shared';
export * from './product';
export * from './customer';
export * from './order';
