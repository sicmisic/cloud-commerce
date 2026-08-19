/**
 * SQS-triggered worker Lambdas (CLAUDE.md §4). Added in Phase 4:
 *   - payment/handler.ts    consumes PaymentRequested
 *   - email/handler.ts      consumes OrderConfirmed / PaymentFailed / ShipmentDispatched
 *   - shipping/handler.ts   consumes ShipmentRequested
 *   - inventory/handler.ts  consumes OrderCreated (reserve) / OrderCancelled (release)
 */
export const PLACEHOLDER = true;
