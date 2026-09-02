import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api } from '../api/client';
import { ApiError, type Address } from '../api/types';
import { useCart } from '../cart/CartContext';
import { Button, EmptyState, Field } from '../components/ui';
import { formatMoney } from '../lib/format';

import './cart.css';

const EMPTY: Address = {
  name: '',
  line1: '',
  city: '',
  region: '',
  postalCode: '',
  country: 'US',
};

export function CheckoutPage() {
  const { lines, subtotal, clear } = useCart();
  const navigate = useNavigate();
  const [address, setAddress] = useState<Address>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // One idempotency key per checkout attempt — stable across retries of the
  // same order, mirroring ADR 004.
  const idempotencyKey = useMemo(() => `checkout-${crypto.randomUUID()}`, []);

  if (lines.length === 0) {
    return <EmptyState title="Nothing to check out">Your cart is empty.</EmptyState>;
  }

  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((a) => ({ ...a, [k]: e.target.value }));

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!address.name.trim()) next.name = 'Required';
    if (!address.line1.trim()) next.line1 = 'Required';
    if (!address.city.trim()) next.city = 'Required';
    if (!address.region.trim()) next.region = 'Required';
    if (address.postalCode.trim().length < 2) next.postalCode = 'Required';
    if (address.country.trim().length !== 2) next.country = 'Use a 2-letter code';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const order = await api.createOrder(
        {
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          shippingAddress: address,
        },
        idempotencyKey,
      );
      clear();
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.problem.title : 'Something went wrong placing your order.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="checkout">
      <h1>Checkout</h1>
      <div className="checkout-grid">
        <form
          onSubmit={submit}
          noValidate
          aria-describedby={formError ? 'checkout-error' : undefined}
        >
          <fieldset disabled={submitting}>
            <legend>Shipping address</legend>
            <div className="form-grid">
              <Field
                name="name"
                label="Full name"
                value={address.name}
                onChange={set('name')}
                error={errors.name}
                autoComplete="name"
              />
              <Field
                name="line1"
                label="Address"
                value={address.line1}
                onChange={set('line1')}
                error={errors.line1}
                autoComplete="address-line1"
              />
              <Field
                name="line2"
                label="Apt, suite (optional)"
                value={address.line2 ?? ''}
                onChange={set('line2')}
                autoComplete="address-line2"
              />
              <Field
                name="city"
                label="City"
                value={address.city}
                onChange={set('city')}
                error={errors.city}
                autoComplete="address-level2"
              />
              <Field
                name="region"
                label="State / region"
                value={address.region}
                onChange={set('region')}
                error={errors.region}
                autoComplete="address-level1"
              />
              <Field
                name="postalCode"
                label="Postal code"
                value={address.postalCode}
                onChange={set('postalCode')}
                error={errors.postalCode}
                autoComplete="postal-code"
              />
              <Field
                name="country"
                label="Country (2-letter)"
                value={address.country}
                onChange={set('country')}
                error={errors.country}
                autoComplete="country"
                maxLength={2}
              />
            </div>
          </fieldset>

          {formError && (
            <p id="checkout-error" className="form-error" role="alert">
              {formError}
            </p>
          )}

          <Button block type="submit" loading={submitting}>
            {submitting ? 'Placing order' : `Place order · ${formatMoney(subtotal)}+`}
          </Button>
          <p className="cart-summary__note">
            Payment is handled by the API's mock provider — no card details needed for this demo.
          </p>
        </form>

        <aside className="checkout-summary">
          <h2>Order</h2>
          <ul>
            {lines.map((l) => (
              <li key={l.productId}>
                <span>
                  {l.quantity} × {l.name}
                </span>
                <span>{formatMoney(l.unitPrice * l.quantity, l.currency)}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
