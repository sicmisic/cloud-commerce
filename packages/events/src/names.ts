/**
 * The domain event catalogue. One source of truth for event names so producers
 * and consumers cannot drift. EventBridge rules in the messaging stack match on
 * these exact `detail-type` values.
 */
export const EVENT_NAMES = {
  OrderCreated: 'OrderCreated',
  OrderConfirmed: 'OrderConfirmed',
  OrderCancelled: 'OrderCancelled',
  InventoryReserved: 'InventoryReserved',
  InventoryReservationFailed: 'InventoryReservationFailed',
  PaymentRequested: 'PaymentRequested',
  PaymentCompleted: 'PaymentCompleted',
  PaymentFailed: 'PaymentFailed',
  ShipmentRequested: 'ShipmentRequested',
  ShipmentDispatched: 'ShipmentDispatched',
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

export const EVENT_SOURCE = 'cloud-commerce.orders';
