import { type Address } from '../order/order';

/**
 * Shipping provider port (label purchase + tracking). Implementations:
 * `MockShippingProvider` and a future `EasyPostShippingProvider`.
 *
 * Reuses the domain {@link Address} type so the order's shipping address flows
 * straight through.
 */

export interface ShipmentRequest {
  readonly idempotencyKey: string;
  readonly orderId: string;
  readonly to: Address;
  readonly weightGrams: number;
  readonly correlationId: string;
}

export interface ShipmentLabel {
  readonly providerShipmentId: string;
  readonly carrier: string;
  readonly trackingNumber: string;
  readonly labelUrl: string;
  readonly estimatedDeliveryDate: string;
  readonly createdAt: string;
}

export interface ShippingProvider {
  readonly name: string;
  createShipment(request: ShipmentRequest): Promise<ShipmentLabel>;
}
