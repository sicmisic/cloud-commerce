import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { Product } from '../api/types';

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  currency: string;
  quantity: number;
  maxQuantity: number;
}

interface CartState {
  lines: CartLine[];
  subtotal: number;
  count: number;
  add: (product: Product, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartState | null>(null);
const STORAGE_KEY = 'cloud-commerce.cart';

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* private mode / quota — cart is still usable in-memory */
    }
  }, [lines]);

  const add = useCallback((product: Product, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((l) => l.productId === product.id);
      const max = product.inventory.available;
      if (existing) {
        return current.map((l) =>
          l.productId === product.id
            ? { ...l, quantity: Math.min(l.quantity + quantity, max), maxQuantity: max }
            : l,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.price.amount,
          currency: product.price.currency,
          quantity: Math.min(quantity, max),
          maxQuantity: max,
        },
      ];
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.productId !== productId)
        : current.map((l) =>
            l.productId === productId ? { ...l, quantity: Math.min(quantity, l.maxQuantity) } : l,
          ),
    );
  }, []);

  const remove = useCallback(
    (productId: string) => setLines((c) => c.filter((l) => l.productId !== productId)),
    [],
  );
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(() => {
    const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    return { lines, subtotal, count, add, setQuantity, remove, clear };
  }, [lines, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
