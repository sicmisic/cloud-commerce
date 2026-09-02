import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api/client';
import { ErrorState, OrderStatusBadge, Spinner } from '../components/ui';
import { formatMoney, formatRelative } from '../lib/format';
import { useAsync } from '../lib/useAsync';

import './order.css';

const STEPS: { status: string; label: string }[] = [
  { status: 'pending', label: 'Order placed' },
  { status: 'confirmed', label: 'Payment confirmed' },
  { status: 'processing', label: 'Shipment dispatched' },
  { status: 'fulfilled', label: 'Delivered' },
];

export function OrderPage() {
  const { id = '' } = useParams();
  const state = useAsync(() => api.getOrder(id), [id]);

  // Poll while the async pipeline is still advancing the order.
  useEffect(() => {
    if (state.status !== 'success') return;
    if (['fulfilled', 'cancelled'].includes(state.data.status)) return;
    const t = setInterval(state.reload, 2000);
    return () => clearInterval(t);
  }, [state]);

  if (state.status === 'loading') return <Spinner label="Loading order" />;
  if (state.status === 'error') return <ErrorState title="Order not found" />;

  const order = state.data;
  const currentIndex = STEPS.findIndex((s) => s.status === order.status);
  const cancelled = order.status === 'cancelled';

  return (
    <section className="order">
      <p>
        <Link to="/">← Continue shopping</Link>
      </p>
      <h1>
        Order {order.id.slice(0, 12)} <OrderStatusBadge status={order.status} />
      </h1>
      <p className="order__placed">Placed {formatRelative(order.createdAt)}</p>

      {!cancelled && (
        <ol className="tracker" aria-label="Order progress">
          {STEPS.map((step, i) => (
            <li
              key={step.status}
              className={`tracker__step${i <= currentIndex ? ' is-done' : ''}${
                i === currentIndex ? ' is-current' : ''
              }`}
            >
              <span className="tracker__dot" aria-hidden="true" />
              {step.label}
            </li>
          ))}
        </ol>
      )}

      <div className="order-cols">
        <div className="order-card">
          <h2>Items</h2>
          <ul className="order-items">
            {order.items.map((i) => (
              <li key={i.id}>
                <span>
                  {i.quantity} × {i.name}
                </span>
                <span>{formatMoney(i.lineTotal, order.currency)}</span>
              </li>
            ))}
          </ul>
          <dl className="order-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(order.subtotal, order.currency)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatMoney(order.tax, order.currency)}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>
                {order.shippingFee === 0 ? 'Free' : formatMoney(order.shippingFee, order.currency)}
              </dd>
            </div>
            <div className="order-totals__grand">
              <dt>Total</dt>
              <dd>{order.totalDisplay}</dd>
            </div>
          </dl>
        </div>

        <div className="order-card">
          <h2>Fulfilment</h2>
          <p>
            Payment: <strong>{order.payments[0]?.status ?? 'pending'}</strong>
          </p>
          <p>
            Shipment: <strong>{order.shipments[0]?.status ?? 'requested'}</strong>
          </p>
          {order.shipments[0]?.trackingNumber && (
            <p>
              Tracking: <code>{order.shipments[0].trackingNumber}</code>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
