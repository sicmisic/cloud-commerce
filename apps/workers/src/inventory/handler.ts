import { type OrderCancelledPayload } from '@cloud-commerce/domain';

import { inventoryReleaser } from '../shared/container';
import { createEventWorker } from '../shared/event-worker';

/** Consumes `OrderCancelled` from the inventory queue and releases reservations. */
export const handler = createEventWorker({
  name: 'inventory',
  handles: ['OrderCancelled'],
  handle: (event) => inventoryReleaser().process(event.payload as OrderCancelledPayload, event.id),
});
