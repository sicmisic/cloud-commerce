/**
 * SQS-triggered worker Lambdas (Phase 4). Each handler is a thin adapter over a
 * fulfillment application service in `@cloud-commerce/domain`.
 */
export { handler as paymentHandler } from './payment/handler';
export { handler as shippingHandler } from './shipping/handler';
export { handler as emailHandler } from './email/handler';
export { handler as inventoryHandler } from './inventory/handler';

export { createEventWorker } from './shared/event-worker';
export {
  __setWorkerContainer,
  __resetWorkerContainer,
  paymentProcessor,
  shipmentProcessor,
  notificationSender,
  inventoryReleaser,
} from './shared/container';
