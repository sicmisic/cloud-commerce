import {
  ConflictError,
  DependencyFailureError,
  type Customer,
  type CustomerRepository,
} from '@cloud-commerce/domain';

import { getPool } from './pool';
import { type Queryable } from './types';

interface CustomerRow {
  id: string;
  email: string;
  name: string;
  auth_subject: string | null;
  created_at: Date;
  updated_at: Date;
}

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  email: r.email,
  name: r.name,
  authSubject: r.auth_subject ?? undefined,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export class PostgresCustomerRepository implements CustomerRepository {
  constructor(private readonly db?: Queryable) {}

  private async q(): Promise<Queryable> {
    return this.db ?? (await getPool());
  }

  async findById(id: string): Promise<Customer | null> {
    return this.one('SELECT * FROM customers WHERE id = $1', [id]);
  }

  async findByEmail(email: string): Promise<Customer | null> {
    return this.one('SELECT * FROM customers WHERE lower(email) = lower($1)', [email]);
  }

  async findByAuthSubject(sub: string): Promise<Customer | null> {
    return this.one('SELECT * FROM customers WHERE auth_subject = $1', [sub]);
  }

  async create(customer: Customer): Promise<void> {
    try {
      const db = await this.q();
      await db.query(
        `INSERT INTO customers (id, email, name, auth_subject, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          customer.id,
          customer.email,
          customer.name,
          customer.authSubject ?? null,
          customer.createdAt,
          customer.updatedAt,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(`Customer with email '${customer.email}' already exists`);
      }
      throw new DependencyFailureError('postgres', err);
    }
  }

  async linkAuthSubject(customerId: string, sub: string): Promise<void> {
    const db = await this.q();
    await db.query('UPDATE customers SET auth_subject = $2, updated_at = now() WHERE id = $1', [
      customerId,
      sub,
    ]);
  }

  private async one(text: string, params: unknown[]): Promise<Customer | null> {
    try {
      const db = await this.q();
      const result = await db.query<CustomerRow>(text, params);
      return result.rows[0] ? toCustomer(result.rows[0]) : null;
    } catch (err) {
      throw new DependencyFailureError('postgres', err);
    }
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
