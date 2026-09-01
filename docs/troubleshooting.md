# Troubleshooting

The whole system is instrumented so an incident is followed **alarm →
correlation id → structured logs → root cause**. This document walks that path
and the deliberate failure scenario.

## The correlation id is the thread

Every request gets an `x-correlation-id` (generated at the API boundary, or
taken from the inbound header). It appears:

- on the HTTP response header,
- on **every** structured log line (`correlationId` field),
- on every EventBridge event (`correlationId` in `detail`, and as the SQS
  message trace),
- on every worker log line (the worker runtime re-establishes the scope from
  the event).

Given one correlation id, this CloudWatch Logs Insights query finds the entire
request across the API and all four workers (run it over the API log group and
the four `/aws/lambda/cloud-commerce-worker-*` groups):

```
fields @timestamp, service, component, worker, level, msg, err.message
| filter correlationId = "<id>"
| sort @timestamp asc
```

## Metrics & alarms

Business metrics are emitted as CloudWatch EMF into the `CloudCommerce`
namespace (dimension `Stage`): `OrdersCreated`, `OrdersFailed`,
`PaymentFailures`, `InventoryReservationFailures`, `IdempotentReplay`. Lambda
runtime metrics (`LambdaDuration`, `LambdaErrors`, queue depth) come from the
`request-context` / worker middleware.

`MonitoringStack` wires these alarms, all notifying the `cloud-commerce-alarms`
SNS topic (subscribe with `ALARM_EMAIL`):

| Alarm                  | Fires when                                    |
| ---------------------- | --------------------------------------------- |
| `apilambdaerrorrate`   | API Lambda error rate > 2% over 10 min        |
| `api5xxrate`           | API Gateway 5xx count > 5 over 10 min         |
| `<worker>queuebacklog` | queue depth > 100 for 15 min                  |
| `<worker>dlqmessages`  | **any** message on a DLQ (threshold 0, 1 min) |
| `rdscpu`               | RDS CPU > 80% for 15 min                      |
| `rdsconnections`       | RDS connections > 80 for 15 min               |

## Scenario walkthrough: payments failing → DLQ

### Arm the fault injector

Non-production only. The mock payment provider fails a fraction of charges
transiently:

```bash
ENV=staging pnpm --filter @cloud-commerce/infrastructure exec \
  cdk deploy Workers-staging -c paymentFaultRate=0.5
```

(or set `PAYMENT_MOCK_FAILURE_RATE=0.5` locally). Production ignores the flag.

### What happens

1. A customer places an order → `PaymentRequested` published, order `pending`.
2. The payment worker calls `provider.charge`; ~50% throw a retryable
   `DependencyFailureError`.
3. The worker rethrows → the SQS message is **not** deleted → redelivered after
   the visibility timeout (180 s).
4. After `maxReceiveCount` (5) redeliveries the message moves to
   `cloud-commerce-payment-dlq-staging`.
5. The `paymentdlqmessages` alarm fires (threshold 0) → SNS.
6. `PaymentFailures` climbs on the dashboard; affected orders stay `pending`.

### Diagnose

```
# 1. From the alarm, note the time window. Find failing payment invocations:
fields @timestamp, correlationId, orderId, err.message
| filter worker = "payment" and level = "error"
| sort @timestamp desc
```

Take a `correlationId` from a failure and run the cross-service query above.
You will see: `request received` (API) → `order created` → `event handled`
failures in the payment worker with `err.message = "Dependency 'payment-provider'
failed"`.

### Recover

Once the root cause is fixed (here: disarm the fault injector and redeploy the
worker), re-drive the DLQ:

```
POST /admin/failed-events/payment/retry        # starts an SQS message-move task
GET  /admin/failed-events                       # depth should fall to 0
GET  /admin/failed-events/payment/retry-status  # task status
```

The re-driven messages are reprocessed by the (now healthy) payment worker;
orders transition `pending → confirmed → processing` and confirmation +
shipment-dispatched emails go out.

## Other quick checks

| Symptom                                           | First check                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INSUFFICIENT_INVENTORY` for an in-stock item     | `available` vs `reserved` on the product item in DynamoDB; look for stuck reservations from orders that were never cancelled                        |
| Orders stuck `pending`                            | payment worker log group, then the payment DLQ depth                                                                                                |
| `POST /orders` returns 409 `idempotency-conflict` | the `Idempotency-Key` was reused with a different body — the client must use a fresh key per distinct order                                         |
| API 5xx with `type: dependency-failure`           | a downstream (DynamoDB / Postgres / EventBridge) is unavailable — check its metrics; the correlation id in the response body pinpoints the log line |
| Emails not sent                                   | email worker log group; `MockEmailProvider` is idempotent so a redelivery is a no-op, not a duplicate                                               |
