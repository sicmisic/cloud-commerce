/**
 * Concrete implementations of the domain provider ports. The port *interfaces*
 * live in `@cloud-commerce/domain` (ports/); this package provides the `Mock*`
 * implementations (and, later, real Stripe / EasyPost / SES adapters).
 */
export { MockPaymentProvider } from './payment/mock-payment-provider';
export { MockShippingProvider } from './shipping/mock-shipping-provider';
export { MockEmailProvider } from './email/mock-email-provider';

export {
  simulate,
  SimulatedProviderError,
  type SimulatedOutcome,
  type SimulationConfig,
} from './shared/simulate';

// Re-export the port types so callers have a single import site.
export type {
  PaymentProvider,
  PaymentChargeRequest,
  PaymentResult,
  RefundRequest,
  RefundResult,
  ShippingProvider,
  ShipmentRequest,
  ShipmentLabel,
  Address as ShippingAddress,
  EmailProvider,
  EmailMessage,
  EmailReceipt,
  EmailTemplate,
} from '@cloud-commerce/domain';
