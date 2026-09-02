export interface Money {
  amount: number;
  currency: string;
  display: string;
}

export type ProductStatus = 'active' | 'inactive' | 'archived';

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  status: ProductStatus;
  price: Money;
  inventory: { available: number; reserved: number };
  imageKeys: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'fulfilled' | 'cancelled';

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: string;
  items: {
    id: string;
    productId: string;
    sku: string;
    name: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  subtotal: number;
  tax: number;
  shippingFee: number;
  total: number;
  totalDisplay: string;
  payments: { id: string; status: string; amount: number }[];
  shipments: { id: string; status: string; trackingNumber: string | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail?: string;
  correlationId?: string;
  issues?: { path: string; message: string }[];
}

export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDocument,
    readonly httpStatus: number,
  ) {
    super(problem.title);
    this.name = 'ApiError';
  }
}
