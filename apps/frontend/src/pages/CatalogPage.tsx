import { useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { useCart } from '../cart/CartContext';
import { Badge, Button, EmptyState, ErrorState, StockBadge } from '../components/ui';
import { formatMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';

import './catalog.css';

export function CatalogPage() {
  const [category, setCategory] = useState<string | null>(null);
  const state = useAsync(() => api.listProducts(category ? { category } : {}), [category]);
  const { add } = useCart();

  return (
    <section>
      <header className="page-head">
        <h1>Shop</h1>
        <p>Everything below is priced and stocked by the Cloud Commerce API.</p>
      </header>

      <div className="filters" role="group" aria-label="Filter by category">
        {[null, 'lighting', 'home', 'kitchen', 'audio', 'stationery'].map((c) => (
          <button
            key={c ?? 'all'}
            className={`chip${category === c ? ' chip--active' : ''}`}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c ?? 'All'}
          </button>
        ))}
      </div>

      {state.status === 'loading' && (
        <ul className="product-grid" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="product-card">
              <div className="skeleton" style={{ aspectRatio: '4 / 3' }} />
              <div className="skeleton" style={{ height: 18, width: '70%', marginTop: 12 }} />
              <div className="skeleton" style={{ height: 14, width: '40%', marginTop: 8 }} />
            </li>
          ))}
        </ul>
      )}

      {state.status === 'error' && (
        <ErrorState title="Couldn't load products" onRetry={state.reload} />
      )}

      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState title="No products in this category yet" />
        ) : (
          <ul className="product-grid">
            {state.data.items.map((p) => {
              const soldOut = p.inventory.available <= 0;
              return (
                <li key={p.id} className="product-card">
                  <Link to={`/products/${p.id}`} className="product-card__media" aria-hidden="true">
                    <span className="product-card__initial">{p.name[0]}</span>
                  </Link>
                  <div className="product-card__body">
                    <h2 className="product-card__title">
                      <Link to={`/products/${p.id}`}>{p.name}</Link>
                    </h2>
                    <div className="product-card__meta">
                      <span className="price">{formatMoney(p.price.amount, p.price.currency)}</span>
                      <Badge>{p.category}</Badge>
                    </div>
                    <div className="product-card__foot">
                      <StockBadge available={p.inventory.available} />
                      <Button
                        variant="ghost"
                        disabled={soldOut}
                        onClick={() => add(p)}
                        aria-label={`Add ${p.name} to cart`}
                      >
                        {soldOut ? 'Sold out' : 'Add to cart'}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}
