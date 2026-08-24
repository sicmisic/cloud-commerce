import { NotFoundError } from '../shared/errors';

import { type Customer, type CreateCustomerInput, createCustomer } from './customer';
import { type CustomerRepository } from './repository';

export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  async getById(id: string): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundError('Customer', id);
    return customer;
  }

  /**
   * Idempotent by email. Returns the existing customer if one is registered,
   * linking it to `authSubject` on the way out if it is not linked yet.
   */
  async register(input: CreateCustomerInput): Promise<Customer> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.customers.findByEmail(email);
    if (existing) {
      if (input.authSubject && !existing.authSubject) {
        await this.customers.linkAuthSubject(existing.id, input.authSubject);
        return { ...existing, authSubject: input.authSubject };
      }
      return existing;
    }
    const customer = createCustomer(input);
    await this.customers.create(customer);
    return customer;
  }

  async findByAuthSubject(sub: string): Promise<Customer | null> {
    return this.customers.findByAuthSubject(sub);
  }
}
