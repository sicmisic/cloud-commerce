import { type PaymentRequestedPayload } from '@cloud-commerce/domain';

import { paymentProcessor } from '../shared/container';
import { createEventWorker } from '../shared/event-worker';

/** Consumes `PaymentRequested` from the payment queue. */
export const handler = createEventWorker({
  name: 'payment',
  handles: ['PaymentRequested'],
  handle: (event) =>
    paymentProcessor().process(event.payload as PaymentRequestedPayload, event.correlationId),
});
