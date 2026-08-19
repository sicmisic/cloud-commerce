/**
 * Shipping provider port (label purchase + tracking). Implementations:
 * {@link MockShippingProvider} and a future `EasyPostShippingProvider`.
 */

export interface Address {
  readonly name: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region: string;
  readonly postalCode: string;
  readonly country: string;
}

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
