import { type ClaimResult, type IdempotencyRecord, type IdempotencyStore } from './idempotency';

/** Test double for {@link IdempotencyStore}. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async claim(key: string, requestHash: string): Promise<ClaimResult> {
    const existing = this.records.get(key);
    if (!existing) {
      this.records.set(key, {
        key,
        status: 'in_progress',
        requestHash,
        createdAt: new Date().toISOString(),
      });
      return { outcome: 'claimed' };
    }
    if (existing.requestHash !== requestHash) return { outcome: 'mismatch', record: existing };
    if (existing.status === 'completed') return { outcome: 'completed', record: existing };
    return { outcome: 'in_progress', record: existing };
  }

  async complete(key: string, response: unknown): Promise<void> {
    const existing = this.records.get(key);
    if (existing) this.records.set(key, { ...existing, status: 'completed', response });
  }

  async release(key: string): Promise<void> {
    this.records.delete(key);
  }

  get size(): number {
    return this.records.size;
  }
}
