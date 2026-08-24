import { type Customer } from './customer';

export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  findByAuthSubject(sub: string): Promise<Customer | null>;
  create(customer: Customer): Promise<void>;
  /** Link an existing customer row to a Cognito subject (Phase 5). */
  linkAuthSubject(customerId: string, sub: string): Promise<void>;
}
