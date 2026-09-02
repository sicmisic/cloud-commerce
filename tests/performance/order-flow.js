/*
 * k6 load test for the order flow (Phase 7 performance testing).
 *
 *   k6 run -e BASE_URL=https://<api> -e TOKEN=<cognito id token> tests/performance/order-flow.js
 *
 * Scenario: browse the catalog, then place an order. Thresholds encode the
 * latency budget from the README's Performance Considerations section.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.TOKEN || '';

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '15s', target: 0 },
      ],
      exec: 'browse',
    },
    checkout: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '1m30s',
      preAllocatedVUs: 10,
      exec: 'checkout',
      startTime: '15s',
    },
  },
  thresholds: {
    'http_req_duration{name:list-products}': ['p(95)<300'],
    'http_req_duration{name:get-product}': ['p(95)<150'],
    'http_req_duration{name:create-order}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const authHeaders = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

export function browse() {
  const list = http.get(`${BASE_URL}/products?limit=20`, {
    headers: authHeaders,
    tags: { name: 'list-products' },
  });
  check(list, { 'list 200': (r) => r.status === 200 });

  const items = list.json('items') || [];
  if (items.length > 0) {
    const pick = items[Math.floor(Math.random() * items.length)];
    const detail = http.get(`${BASE_URL}/products/${pick.id}`, {
      headers: authHeaders,
      tags: { name: 'get-product' },
    });
    check(detail, { 'detail 200': (r) => r.status === 200 });
  }
  sleep(Math.random() * 2);
}

export function checkout() {
  const list = http.get(`${BASE_URL}/products?limit=5`, { headers: authHeaders });
  const items = list.json('items') || [];
  if (items.length === 0) return;

  const res = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({
      lines: [{ productId: items[0].id, quantity: 1 }],
      shippingAddress: {
        name: 'Load Test',
        line1: '1 Bench Rd',
        city: 'Testville',
        region: 'CA',
        postalCode: '94000',
        country: 'US',
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `k6-${uuidv4()}`,
        ...authHeaders,
      },
      tags: { name: 'create-order' },
    },
  );
  check(res, { 'order created or out of stock': (r) => [201, 409].includes(r.status) });
}
