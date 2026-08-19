# Deployment

## Environments

`dev`, `staging`, `production` — separate CDK stacks and config
(`infrastructure/config/environments.ts`), selected with `-c env=<name>` or
`ENV=<name>`. They may initially point at one AWS account; production gets
Multi-AZ RDS, PITR, longer log retention, and stricter throttles.

## Prerequisites

- Node 20+, pnpm 10+
- AWS credentials with permission to deploy the stacks
- One-time per account/region: `pnpm --filter @cloud-commerce/infrastructure exec cdk bootstrap`

## Deploy

```bash
pnpm install
pnpm build
pnpm test
ENV=staging pnpm --filter @cloud-commerce/infrastructure deploy      # all stacks
ENV=staging pnpm --filter @cloud-commerce/infrastructure exec cdk diff
```

Stacks (deploy order is resolved automatically by CDK dependencies):

1. `Storage-<env>` — S3 buckets
2. `Database-<env>` — DynamoDB tables (RDS added Phase 3)
3. `Messaging-<env>` — EventBridge bus (SQS queues added Phase 4)
4. `Api-<env>` — Lambda + HTTP API
5. `Monitoring-<env>` — dashboard (alarms added Phase 6)

## CI/CD (`.github/workflows`)

- **test.yml** — on every PR: install → lint → format check → typecheck →
  unit + contract + e2e; a separate job runs integration tests against
  `postgres` and `dynamodb-local` service containers.
- **security.yml** — `pnpm audit`, CodeQL, Trufflehog secret scan.
- **deploy.yml** — on merge to `main`: build → deploy to staging → smoke tests.
  Production deploy is a manual `workflow_dispatch` gated by a GitHub
  environment protection rule. Auth to AWS is via OIDC (no static keys).

## Secrets

All runtime credentials (database, payment/shipping provider keys) live in
Secrets Manager and are referenced by ARN in Lambda env vars. Nothing sensitive
is in the repo, CDK context, or CloudFormation parameters. See CLAUDE.md §8.

## Rollback

`cdk deploy` is a CloudFormation change set — a failed deploy rolls back
automatically. To roll back a healthy-but-bad release, redeploy the previous
git tag. Database migrations are forward-only and must be backward-compatible;
a bad migration is fixed with a new migration, not a down-migration in prod.
