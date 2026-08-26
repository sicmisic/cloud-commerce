import { type PaymentCompletedPayload } from '@cloud-commerce/domain';

import { shipmentProcessor } from '../shared/container';
import { createEventWorker } from '../shared/event-worker';

/** Consumes `PaymentCompleted` from the shipping queue. */
export const handler = createEventWorker({
  name: 'shipping',
  handles: ['PaymentCompleted'],
  handle: (event) =>
    shipmentProcessor().process(event.payload as PaymentCompletedPayload, event.correlationId),
});
