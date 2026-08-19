# ADR 005 — One API Lambda with an internal router

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** Platform team

## Context

The HTTP API needs to map many routes (`/products`, `/orders`,
`/admin/failed-events`, …) to handlers. AWS offers two shapes: one Lambda per
route (or per resource), or one Lambda behind a `{proxy+}` route that dispatches
internally.

## Decision

Ship one `api` Lambda behind an API Gateway HTTP API catch-all route. A tiny
dependency-free router (`apps/api/src/http/router.ts`) dispatches to controllers.
Handlers stay thin (parse → controller → service → response); the middleware
pipeline (context/correlation, CORS, error mapping, auth, rate limit) is shared.

The Lambda's IAM role is still scoped to exactly the resources it touches
(specific tables, specific bus, specific secrets) — a single function does **not**
mean a broad policy (CLAUDE.md §8).

## Trade-offs considered

- **Lambda per route.** Finest-grained IAM and independent scaling/rollout per
  endpoint. Costs: N× cold starts, N× deploy artifacts, duplicated middleware
  wiring, and a much larger CDK surface. For this project's traffic and team
  size the operational overhead outweighs the isolation benefit.
- **A framework (Express/Fastify via `@vendia/serverless-express`).** Familiar,
  but pulls a web server and its middleware ecosystem into a Lambda that only
  ever sees one request at a time. The hand-rolled router is ~120 lines and
  keeps the cold-start bundle small.

## Consequences

- A bad deploy affects all routes at once; mitigated by staging + smoke tests
  and (future) Lambda alias canary deploys.
- If one route becomes a scaling or blast-radius concern, it can be peeled out
  into its own function without changing the controller/service code — only the
  CDK wiring and the route table.
- The single role is the union of all route permissions; per-route least
  privilege would require the split above. This is documented, not hidden.
