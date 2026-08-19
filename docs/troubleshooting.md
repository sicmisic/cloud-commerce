# Troubleshooting

> The end-to-end path from **alarm → correlation id → structured logs → root
> cause** is finalised in Phase 6 alongside the deliberate failure scenario.
> This is the skeleton.

## The correlation id is the thread

Every request gets an `x-correlation-id` (generated at the API boundary or taken
from the inbound header). It is:

- on the HTTP response header,
- on every structured log line (`correlationId` field),
- attached to every EventBridge event (`correlationId` in the detail and as the
  `TraceHeader`),
- carried into every SQS message and worker log line.

Given a correlation id, this finds the whole request across the API and all
workers:

```
fields @timestamp, service, component, level, msg, err.message
| filter correlationId = "<id>"
| sort @timestamp asc
```

(run across the API and worker log groups)

## Common scenarios

| Symptom                                    | First check                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| API 5xx spike                              | `LambdaErrors` metric + `level=error` logs for the window; group by `err.name`                         |
| Orders stuck "processing"                  | payment worker log group; then the payment DLQ depth                                                   |
| DLQ alarm firing                           | `GET /admin/failed-events` → inspect message → fix → `POST /admin/failed-events/{id}/retry`            |
| `INSUFFICIENT_INVENTORY` for in-stock item | check `reserved` vs `available` on the product item; look for stuck reservations from cancelled orders |
| Payment always failing in dev              | `PAYMENT_MOCK_FAILURE_RATE` env var — the deliberate fault injector (Phase 6)                          |

## Deliberate failure scenario _(Phase 6)_

Setting `PAYMENT_MOCK_FAILURE_RATE=0.5` makes the mock payment provider throw
retryable errors ~50% of the time. Expected chain: worker retries → exhausts
`maxReceiveCount` → message lands on the payment DLQ → `DLQMessages` alarm →
operator follows the correlation id from the alarm to the failing invocation.
Full walkthrough added in Phase 6.
