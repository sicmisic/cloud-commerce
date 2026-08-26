import {
  type PaymentCompletedPayload,
  type ShipmentDispatchedPayload,
  shipmentDispatchedEvent,
} from '../order/events';
import { type OrderRepository } from '../order/repository';
import { newShipment } from '../order/shipment';
import { type ShippingProvider } from '../ports/shipping-provider';
import { DependencyFailureError } from '../shared/errors';
import { type EventPublisher } from '../shared/events';
import { type IdempotencyStore } from '../shared/idempotency';
import { type Logger, noopLogger } from '../shared/logger';

export interface ShipmentProcessorDeps {
  readonly orders: OrderRepository;
  readonly provider: ShippingProvider;
  readonly events: EventPublisher;
  readonly idempotency: IdempotencyStore;
  readonly idempotencyTtlSeconds?: number;
  readonly logger?: Logger;
}

/**
 * Consumes `PaymentCompleted`. Buys a shipping label, records it on the
 * shipment row, advances the order to `processing`, and publishes
 * `ShipmentDispatched`.
 */
export class ShipmentProcessor {
  private readonly log: Logger;
  private readonly ttl: number;

  constructor(private readonly deps: ShipmentProcessorDeps) {
    this.log = deps.logger ?? noopLogger;
    this.ttl = deps.idempotencyTtlSeconds ?? 86_400;
  }

  async process(payload: PaymentCompletedPayload, correlationId: string): Promise<void> {
    const idemKey = `shipment#${payload.orderId}`;
    const claim = await this.deps.idempotency.claim(idemKey, payload.orderId, this.ttl);
    if (claim.outcome === 'completed') {
      this.log.info({ orderId: payload.orderId }, 'shipment already created — skipping');
      return;
    }
    if (claim.outcome === 'in_progress') {
      throw new DependencyFailureError(
        'idempotency',
        'shipment claim held by a concurrent attempt',
      );
    }

    const order = await this.deps.orders.findById(payload.orderId);
    if (!order) {
      // Order vanished — nothing to ship. Ack.
      await this.deps.idempotency.complete(idemKey, { skipped: 'order-not-found' });
      return;
    }

    try {
      const label = await this.deps.provider.createShipment({
        idempotencyKey: idemKey,
        orderId: order.id,
        to: order.shippingAddress,
        weightGrams: order.items.reduce((g, i) => g + i.quantity * 500, 0),
        correlationId,
      });

      const base = newShipment({ orderId: order.id, address: order.shippingAddress });
      await this.deps.orders.saveShipment({
        ...base,
        id: order.shipments[0]?.id ?? base.id,
        status: 'dispatched',
        carrier: label.carrier,
        trackingNumber: label.trackingNumber,
        providerRef: label.providerShipmentId,
        estimatedDeliveryDate: label.estimatedDeliveryDate,
      });

      await this.deps.orders
        .updateStatus(order.id, 'processing', ['confirmed'])
        .catch((err) => this.log.warn({ err, orderId: order.id }, 'order already advanced'));

      const dispatched: ShipmentDispatchedPayload = {
        orderId: order.id,
        shipmentId: order.shipments[0]?.id ?? base.id,
        customerId: order.customerId,
        carrier: label.carrier,
        trackingNumber: label.trackingNumber,
        estimatedDeliveryDate: label.estimatedDeliveryDate,
      };
      await this.deps.events.publish(shipmentDispatchedEvent(dispatched, correlationId));
      await this.deps.idempotency.complete(idemKey, { trackingNumber: label.trackingNumber });
      this.log.info(
        { orderId: order.id, trackingNumber: label.trackingNumber },
        'shipment dispatched',
      );
    } catch (err) {
      await this.deps.idempotency.release(idemKey).catch(() => undefined);
      this.log.error({ err, orderId: order.id }, 'shipment creation failed');
      throw err;
    }
  }
}
