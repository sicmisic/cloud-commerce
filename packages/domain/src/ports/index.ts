/**
 * External-provider ports (CLAUDE.md §3). The interfaces live in the domain so
 * application services depend only on the domain; concrete implementations
 * (`Mock*` today, real SDKs later) live in `@cloud-commerce/integrations`.
 */
export * from './payment-provider';
export * from './shipping-provider';
export * from './email-provider';
