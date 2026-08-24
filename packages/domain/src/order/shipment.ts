import { newId } from '../shared/ids';

import { type Address } from './order';

export const SHIPMENT_STATUSES = ['requested', 'dispatched', 'delivered', 'failed'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface Shipment {
  readonly id: string;
  readonly orderId: string;
  readonly status: ShipmentStatus;
  readonly address: Address;
  readonly carrier?: string;
  readonly trackingNumber?: string;
  readonly providerRef?: string;
  readonly estimatedDeliveryDate?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function newShipment(input: { orderId: string; address: Address }): Shipment {
  const ts = new Date().toISOString();
  return {
    id: newId('shipment'),
    orderId: input.orderId,
    status: 'requested',
    address: input.address,
    createdAt: ts,
    updatedAt: ts,
  };
}
