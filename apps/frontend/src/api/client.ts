import { mockApi } from './mock';
import { ApiError, type Address, type Order, type Page, type Product } from './types';

/**
 * API client. Talks to `VITE_API_BASE_URL` when set; otherwise falls back to an
 * in-memory mock so the storefront runs with no backend (`pnpm --filter
 * @cloud-commerce/frontend dev`).
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const USE_MOCK = !BASE_URL;

let token: string | null = null;
export function setAuthToken(t: string | null): void {
  token = t;
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(
      data ?? { type: 'unknown', title: res.statusText, status: res.status },
      res.status,
    );
  }
  return data as T;
}

export interface ProductQuery {
  category?: string;
  limit?: number;
  cursor?: string;
}

export const api = {
  useMock: USE_MOCK,

  listProducts(query: ProductQuery = {}): Promise<Page<Product>> {
    if (USE_MOCK) return mockApi.listProducts(query);
    const qs = new URLSearchParams();
    if (query.category) qs.set('category', query.category);
    if (query.limit) qs.set('limit', String(query.limit));
    if (query.cursor) qs.set('cursor', query.cursor);
    return request('GET', `/products?${qs.toString()}`);
  },

  getProduct(id: string): Promise<Product> {
    if (USE_MOCK) return mockApi.getProduct(id);
    return request('GET', `/products/${id}`);
  },

  createOrder(
    input: { lines: { productId: string; quantity: number }[]; shippingAddress: Address },
    idempotencyKey: string,
  ): Promise<Order> {
    if (USE_MOCK) return mockApi.createOrder(input, idempotencyKey);
    return request('POST', '/orders', { body: input, idempotencyKey });
  },

  getOrder(id: string): Promise<Order> {
    if (USE_MOCK) return mockApi.getOrder(id);
    return request('GET', `/orders/${id}`);
  },
};
