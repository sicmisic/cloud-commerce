import { type DomainEvent, makeEvent } from '../shared/events';
import { type Money } from '../shared/money';

import { type Order } from './order';

/** Payload schemas for order domain events (consumed by Phase 4 workers). */

export interface OrderCreatedPayload {
  orderId: string;
  customerId: string;
  total: Money;
  currency: string;
  lines: { productId: string; sku: string; quantity: number }[];
  shippingAddress: Order['shippingAddress'];
}

export interface OrderCancelledPayload {
  orderId: string;
  customerId: string;
  reason: string;
  releasedLines: { productId: string; quantity: number }[];
}

export interface PaymentRequestedPayload {
  orderId: string;
  paymentId: string;
  customerId: string;
  amount: Money;
}

export function orderCreatedEvent(
  order: Order,
  correlationId: string,
): DomainEvent<'OrderCreated', OrderCreatedPayload> {
  return makeEvent({
    name: 'OrderCreated',
    correlationId,
    subject: `order/${order.id}`,
    payload: {
      orderId: order.id,
      customerId: order.customerId,
      total: order.total,
      currency: order.currency,
      lines: order.items.map((i) => ({ productId: i.productId, sku: i.sku, quantity: i.quantity })),
      shippingAddress: order.shippingAddress,
    },
  });
}

export function paymentRequestedEvent(
  order: Order,
  paymentId: string,
  correlationId: string,
): DomainEvent<'PaymentRequested', PaymentRequestedPayload> {
  return makeEvent({
    name: 'PaymentRequested',
    correlationId,
    subject: `order/${order.id}`,
    payload: {
      orderId: order.id,
      paymentId,
      customerId: order.customerId,
      amount: order.total,
    },
  });
}

export function orderCancelledEvent(
  order: Order,
  reason: string,
  correlationId: string,
): DomainEvent<'OrderCancelled', OrderCancelledPayload> {
  return makeEvent({
    name: 'OrderCancelled',
    correlationId,
    subject: `order/${order.id}`,
    payload: {
      orderId: order.id,
      customerId: order.customerId,
      reason,
      releasedLines: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    },
  });
}
