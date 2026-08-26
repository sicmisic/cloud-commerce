/**
 * Worker-side application services (Phase 4). Each consumes one or more domain
 * events and advances the order lifecycle. Framework-free: they depend on the
 * domain ports (repository, event publisher, idempotency store, provider) and
 * are unit-tested with in-memory doubles.
 */
export { PaymentProcessor, type PaymentProcessorDeps } from './payment-processor';
export { ShipmentProcessor, type ShipmentProcessorDeps } from './shipment-processor';
export { NotificationSender, type NotificationSenderDeps } from './notification-sender';
export { InventoryReleaser, type InventoryReleaserDeps } from './inventory-releaser';
