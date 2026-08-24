import { ConflictError } from '../shared/errors';

import { type Customer } from './customer';
import { type CustomerRepository } from './repository';

export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly byId = new Map<string, Customer>();

  constructor(seed: Customer[] = []) {
    for (const c of seed) this.byId.set(c.id, c);
  }

  async findById(id: string): Promise<Customer | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<Customer | null> {
    const lower = email.toLowerCase();
    for (const c of this.byId.values()) if (c.email === lower) return c;
    return null;
  }

  async findByAuthSubject(sub: string): Promise<Customer | null> {
    for (const c of this.byId.values()) if (c.authSubject === sub) return c;
    return null;
  }

  async create(customer: Customer): Promise<void> {
    if (await this.findByEmail(customer.email)) {
      throw new ConflictError(`Customer with email '${customer.email}' already exists`);
    }
    this.byId.set(customer.id, customer);
  }

  async linkAuthSubject(customerId: string, sub: string): Promise<void> {
    const current = this.byId.get(customerId);
    if (!current) return;
    this.byId.set(customerId, {
      ...current,
      authSubject: sub,
      updatedAt: new Date().toISOString(),
    });
  }

  all(): Customer[] {
    return [...this.byId.values()];
  }
}
