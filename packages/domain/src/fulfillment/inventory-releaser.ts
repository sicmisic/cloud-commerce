import { type OrderCancelledPayload } from '../order/events';
import { type CatalogService } from '../product/service';
import { type IdempotencyStore } from '../shared/idempotency';
import { type Logger, noopLogger } from '../shared/logger';

export interface InventoryReleaserDeps {
  readonly catalog: CatalogService;
  readonly idempotency: IdempotencyStore;
  readonly idempotencyTtlSeconds?: number;
  readonly logger?: Logger;
}

/**
 * Consumes `OrderCancelled`. Releases the reserved units back to the catalog.
 * The order service already releases synchronously on an operator cancel; this
 * worker is the compensation path for cancels that originate from an async
 * failure (e.g. payment permanently declined) and the safety net if the sync
 * release failed. Releasing is naturally idempotent (clamped at zero reserved),
 * but we still guard with the idempotency store to avoid noisy retries.
 */
export class InventoryReleaser {
  private readonly log: Logger;
  private readonly ttl: number;

  constructor(private readonly deps: InventoryReleaserDeps) {
    this.log = deps.logger ?? noopLogger;
    this.ttl = deps.idempotencyTtlSeconds ?? 86_400;
  }

  async process(payload: OrderCancelledPayload, eventId: string): Promise<void> {
    const idemKey = `inventory-release#${payload.orderId}`;
    const claim = await this.deps.idempotency.claim(idemKey, eventId, this.ttl);
    if (claim.outcome === 'completed') {
      this.log.info({ orderId: payload.orderId }, 'inventory already released — skipping');
      return;
    }

    try {
      for (const line of payload.releasedLines) {
        await this.deps.catalog.release(line.productId, line.quantity);
      }
      await this.deps.idempotency.complete(idemKey, { released: payload.releasedLines.length });
      this.log.info(
        { orderId: payload.orderId, lines: payload.releasedLines.length },
        'inventory released for cancelled order',
      );
    } catch (err) {
      await this.deps.idempotency.release(idemKey).catch(() => undefined);
      throw err;
    }
  }
}
