import { ValidationError } from '../shared/errors';
import { newId } from '../shared/ids';

export interface Customer {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** Cognito `sub`, once the customer is linked to an auth identity (Phase 5). */
  readonly authSubject?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCustomerInput {
  email: string;
  name: string;
  authSubject?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function createCustomer(input: CreateCustomerInput): Customer {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new ValidationError('a valid email is required', { email: input.email });
  }
  if (!input.name.trim()) {
    throw new ValidationError('name is required');
  }
  const ts = new Date().toISOString();
  return {
    id: newId('customer'),
    email,
    name: input.name.trim(),
    authSubject: input.authSubject,
    createdAt: ts,
    updatedAt: ts,
  };
}
