import { notificationSender } from '../shared/container';
import { createEventWorker } from '../shared/event-worker';

/** Consumes order lifecycle events from the email queue and sends notifications. */
export const handler = createEventWorker({
  name: 'email',
  handles: ['OrderCreated', 'PaymentFailed', 'ShipmentDispatched', 'OrderCancelled'],
  handle: (event) => notificationSender().handle(event),
});
