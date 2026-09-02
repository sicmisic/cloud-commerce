import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

import type { OrderStatus } from '../api/types';

import './ui.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
  block?: boolean;
  loading?: boolean;
};

export function Button({ variant = 'primary', block, loading, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`btn btn--${variant}${block ? ' btn--block' : ''}`}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return <span className={`badge${tone === 'neutral' ? '' : ` badge--${tone}`}`}>{children}</span>;
}

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  confirmed: 'neutral',
  processing: 'neutral',
  fulfilled: 'success',
  cancelled: 'danger',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

export function StockBadge({ available }: { available: number }) {
  if (available <= 0) return <Badge tone="danger">Out of stock</Badge>;
  if (available <= 3) return <Badge tone="warning">Only {available} left</Badge>;
  return <Badge tone="success">In stock</Badge>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--c-text-muted)' }}
    >
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state state--error" role="alert">
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {onRetry && (
        <p style={{ marginTop: 'var(--s-4)' }}>
          <Button variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        </p>
      )}
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string };

export function Field({ label, error, id, ...rest }: FieldProps) {
  const fieldId = id ?? rest.name;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} aria-invalid={error ? true : undefined} {...rest} />
      {error && (
        <span className="hint" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
