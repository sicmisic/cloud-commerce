# ADR 006 — Provider ports in the domain; a `fulfillment` module for worker use cases

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Platform team

## Context

Phase 4 added the worker-side application services (charge payment, buy a
shipping label, send a notification, release inventory). Each needs both a
domain repository port **and** an external-provider port
(`PaymentProvider` / `ShippingProvider` / `EmailProvider`). Those provider
interfaces were originally defined in `@cloud-commerce/integrations` alongside
their `Mock*` implementations. A worker application service living in
`@cloud-commerce/domain` cannot import from `integrations` without
`domain → integrations → domain` becoming a cycle.

The repo layout in CLAUDE.md §10 has `apps/workers` but no home for worker
_application_ services, and §3 requires those services to be framework-free and
port-only.

## Decision

Two small changes, both within the spirit of the hexagonal layout CLAUDE.md §3
already mandates:

1. **Move the provider _interfaces_ into `@cloud-commerce/domain/ports/`.** The
   domain owns every port it depends on. `@cloud-commerce/integrations` keeps
   the concrete `Mock*` implementations (and, later, real Stripe / EasyPost /
   SES adapters) and re-exports the types for convenience.

2. **Add `@cloud-commerce/domain/fulfillment/`** — `PaymentProcessor`,
   `ShipmentProcessor`, `NotificationSender`, `InventoryReleaser`. These are
   application services in the same sense as `OrderService` / `CatalogService`:
   pure orchestration over ports, unit-tested with in-memory doubles.
   `apps/workers` stays a thin adapter layer (SQS event → correlation scope →
   call a fulfillment service), mirroring `apps/api`.

No new package was created (which §10 discourages); the changes are new
directories inside the existing `domain` package.

## Trade-offs considered

- **A new `packages/fulfillment` depending on domain + integrations.** Cleanest
  dependency story, but it is the "restructure without a stated reason" §10
  warns against, and it splits application services across two packages for no
  real benefit.
- **Put the worker services in `apps/workers/src/`.** Keeps domain untouched,
  but then worker business logic is not in a package, is inconsistent with where
  `OrderService` lives, and mixes framework-adapter code with domain logic.
- **Leave the provider interfaces in `integrations` and have the domain import
  them.** Creates the import cycle above.

## Consequences

- `@cloud-commerce/integrations` is now purely implementations; its public types
  come from `@cloud-commerce/domain`.
- The provider port `PaymentStatus` was renamed `ProviderPaymentStatus` to avoid
  colliding with the order-domain `PaymentStatus`.
- The domain package has one intra-package dependency edge
  (`ports → order` for the shared `Address` type); acceptable and acyclic.
