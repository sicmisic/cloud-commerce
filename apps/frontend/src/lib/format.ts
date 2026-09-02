export function formatMoney(amountMinor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelative(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 60) return RELATIVE.format(mins, 'minute');
  return RELATIVE.format(Math.round(mins / 60), 'hour');
}
