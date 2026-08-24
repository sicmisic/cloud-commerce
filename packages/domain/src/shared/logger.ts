/**
 * Minimal logging port. Keeps the domain layer free of a concrete logging
 * dependency while still letting application services emit structured events.
 * `@cloud-commerce/logging`'s Pino logger satisfies this structurally; tests
 * use {@link noopLogger}.
 */
export interface Logger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
