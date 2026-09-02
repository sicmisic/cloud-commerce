import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api/client';
import { useCart } from '../cart/CartContext';
import { Button, ErrorState, Spinner, StockBadge } from '../components/ui';
import { formatMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function ProductPage() {
  const { id = '' } = useParams();
  const state = useAsync(() => api.getProduct(id), [id]);
  const { add } = useCart();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);

  if (state.status === 'loading') return <Spinner label="Loading product" />;
  if (state.status === 'error') {
    return (
      <ErrorState
        title="Product not found"
        detail="It may have been archived."
        onRetry={() => navigate('/')}
      />
    );
  }

  const product = state.data;
  const max = product.inventory.available;
  const soldOut = max <= 0;

  return (
    <article className="product-detail">
      <div className="product-detail__media" aria-hidden="true">
        {product.name[0]}
      </div>
      <div>
        <p style={{ margin: 0 }}>
          <Link to="/">← Back to shop</Link>
        </p>
        <h1>{product.name}</h1>
        <StockBadge available={max} />
        <span className="price">{formatMoney(product.price.amount, product.price.currency)}</span>
        <p>{product.description}</p>

        <div style={{ display: 'flex', gap: 'var(--s-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="qty" aria-label="Quantity">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span aria-live="polite">{qty}</span>
            <button
              onClick={() => setQty((q) => Math.min(max, q + 1))}
              disabled={qty >= max}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <Button
            disabled={soldOut}
            onClick={() => {
              add(product, qty);
              navigate('/cart');
            }}
          >
            {soldOut ? 'Sold out' : `Add ${qty} to cart`}
          </Button>
        </div>

        <dl className="spec">
          <div>
            <dt>SKU</dt>
            <dd>{product.sku}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{product.category}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
