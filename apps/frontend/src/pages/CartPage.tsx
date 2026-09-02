import { Link, useNavigate } from 'react-router-dom';

import { useCart } from '../cart/CartContext';
import { Button, EmptyState } from '../components/ui';
import { formatMoney } from '../lib/format';

import './cart.css';

const TAX_RATE = 0.08;
const FREE_SHIPPING_THRESHOLD = 7500;
const FLAT_SHIPPING = 899;

export function CartPage() {
  const { lines, subtotal, setQuantity, remove } = useCart();
  const navigate = useNavigate();

  if (lines.length === 0) {
    return (
      <EmptyState title="Your cart is empty">
        <Link to="/">Browse the shop</Link>
      </EmptyState>
    );
  }

  const tax = Math.round(subtotal * TAX_RATE);
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  const total = subtotal + tax + shipping;

  return (
    <section className="cart">
      <h1>Cart</h1>
      <ul className="cart-lines">
        {lines.map((line) => (
          <li key={line.productId} className="cart-line">
            <div className="cart-line__info">
              <span className="cart-line__name">{line.name}</span>
              <span className="cart-line__unit">
                {formatMoney(line.unitPrice, line.currency)} each
              </span>
            </div>
            <label className="cart-line__qty">
              <span className="visually-hidden">Quantity for {line.name}</span>
              <select
                value={line.quantity}
                onChange={(e) => setQuantity(line.productId, Number(e.target.value))}
              >
                {Array.from(
                  { length: Math.max(line.maxQuantity, line.quantity) },
                  (_, i) => i + 1,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="cart-line__total">
              {formatMoney(line.unitPrice * line.quantity, line.currency)}
            </span>
            <button className="cart-line__remove" onClick={() => remove(line.productId)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="cart-summary">
        <Row label="Subtotal" value={formatMoney(subtotal)} />
        <Row label="Estimated tax (8%)" value={formatMoney(tax)} />
        <Row label="Shipping" value={shipping === 0 ? 'Free' : formatMoney(shipping)} />
        <Row label="Total" value={formatMoney(total)} strong />
        <Button block onClick={() => navigate('/checkout')}>
          Checkout
        </Button>
        <p className="cart-summary__note">
          Prices and stock are confirmed by the API when you place the order.
        </p>
      </div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`sum-row${strong ? ' sum-row--strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
