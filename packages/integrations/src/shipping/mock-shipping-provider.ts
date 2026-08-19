import { randomUUID } from 'node:crypto';

import { DependencyFailureError } from '@cloud-commerce/domain';
import { logger } from '@cloud-commerce/logging';

import { simulate, SimulatedProviderError, type SimulationConfig } from '../shared/simulate';

import { type ShippingProvider, type ShipmentRequest, type ShipmentLabel } from './provider';

const log = logger('MockShippingProvider');

export class MockShippingProvider implements ShippingProvider {
  readonly name = 'mock';
  private readonly shipments = new Map<string, ShipmentLabel>();

  constructor(private readonly simulation: SimulationConfig = {}) {}

  async createShipment(request: ShipmentRequest): Promise<ShipmentLabel> {
    const existing = this.shipments.get(request.idempotencyKey);
    if (existing) return existing;

    try {
      await simulate(this.simulation);
    } catch (err) {
      if (err instanceof SimulatedProviderError) {
        log.warn({ outcome: err.outcome, orderId: request.orderId }, 'simulated shipping failure');
        throw new DependencyFailureError('shipping-provider', err.message);
      }
      throw err;
    }

    const eta = new Date();
    eta.setDate(eta.getDate() + 4);
    const label: ShipmentLabel = {
      providerShipmentId: `mock_shp_${randomUUID()}`,
      carrier: 'MOCK-EXPRESS',
      trackingNumber: `MX${Math.floor(Math.random() * 1e12)
        .toString()
        .padStart(12, '0')}`,
      labelUrl: `https://labels.mock.local/${request.orderId}.pdf`,
      estimatedDeliveryDate: eta.toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    this.shipments.set(request.idempotencyKey, label);
    log.info(
      { orderId: request.orderId, trackingNumber: label.trackingNumber },
      'shipment created',
    );
    return label;
  }

  reset(): void {
    this.shipments.clear();
  }
}
