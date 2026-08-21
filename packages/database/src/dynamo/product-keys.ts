import { type Product } from '@cloud-commerce/domain';

/**
 * Key layout for the `catalog` table. One item per product. Three GSIs, one per
 * non-key access pattern (docs/database.md). Keeping the mapping in one file
 * makes the "access patterns drive the schema" rule auditable.
 */

export const PRODUCT_PK = (id: string) => `PRODUCT#${id}`;
export const CATEGORY_GSI_PK = (category: string) => `CATEGORY#${category.toLowerCase()}`;
export const STATUS_GSI_PK = (status: string) => `STATUS#${status}`;
export const SKU_GSI_PK = (sku: string) => `SKU#${sku.toUpperCase()}`;

/** Sort key for the category / status indexes — name first for A→Z listing. */
export const listSortKey = (name: string, id: string) => `${name.toLowerCase()}#${id}`;

export interface ProductItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI3PK: string;
  GSI3SK: string;
  entity: 'PRODUCT';
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  status: Product['status'];
  priceAmount: number;
  priceCurrency: string;
  available: number;
  reserved: number;
  imageKeys: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toItem(product: Product): ProductItem {
  return {
    PK: PRODUCT_PK(product.id),
    SK: PRODUCT_PK(product.id),
    GSI1PK: CATEGORY_GSI_PK(product.category),
    GSI1SK: listSortKey(product.name, product.id),
    GSI2PK: SKU_GSI_PK(product.sku),
    GSI3PK: STATUS_GSI_PK(product.status),
    GSI3SK: listSortKey(product.name, product.id),
    entity: 'PRODUCT',
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    status: product.status,
    priceAmount: product.price.amount,
    priceCurrency: product.price.currency,
    available: product.inventory.available,
    reserved: product.inventory.reserved,
    imageKeys: product.imageKeys,
    version: product.version,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function fromItem(item: Record<string, unknown>): Product {
  return {
    id: String(item.id),
    sku: String(item.sku),
    name: String(item.name),
    description: String(item.description),
    category: String(item.category),
    status: item.status as Product['status'],
    price: { amount: Number(item.priceAmount), currency: String(item.priceCurrency) },
    inventory: { available: Number(item.available), reserved: Number(item.reserved) },
    imageKeys: Array.isArray(item.imageKeys) ? (item.imageKeys as string[]) : [],
    version: Number(item.version),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  };
}
