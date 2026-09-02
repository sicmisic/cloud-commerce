import { Link, NavLink, Outlet } from 'react-router-dom';

import { api } from '../api/client';
import { useCart } from '../cart/CartContext';

import './Layout.css';

export function Layout() {
  const { count } = useCart();

  return (
    <div className="layout">
      <a href="#main" className="visually-hidden">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container site-header__inner">
          <Link to="/" className="brand">
            Cloud&nbsp;Commerce
          </Link>
          <nav aria-label="Primary">
            <NavLink to="/" end>
              Shop
            </NavLink>
          </nav>
          <Link
            to="/cart"
            className="cart-link"
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
          >
            Cart
            {count > 0 && <span className="cart-count">{count}</span>}
          </Link>
        </div>
        {api.useMock && (
          <p className="demo-banner" role="status">
            Demo mode — running against an in-memory mock. Set <code>VITE_API_BASE_URL</code> to use
            a deployed API.
          </p>
        )}
      </header>
      <main id="main" className="container site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container">
          A portfolio storefront for the Cloud Commerce &amp; Inventory API.
        </div>
      </footer>
    </div>
  );
}
