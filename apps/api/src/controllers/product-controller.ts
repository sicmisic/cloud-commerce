import { requirePermission } from '@cloud-commerce/auth';
import { type Product, format as formatMoney } from '@cloud-commerce/domain';
import { parseOrThrow, schemas } from '@cloud-commerce/validation';

import { getCatalogService } from '../container';
import { created, noContent, ok } from '../http/response';
import { type HttpRequest } from '../http/types';
import { requireAuth } from '../middleware/auth';

/**
 * Thin controller: validate (Zod) -> call CatalogService -> format. No business
 * logic, no persistence. Write operations require the `catalog:write`
 * permission (OPERATIONS / ADMIN); reads are public.
 */
export class ProductController {
  private get service() {
    return getCatalogService();
  }

  async list(req: HttpRequest) {
    const query = parseOrThrow(schemas.listProductsQuerySchema, req.query);
    const page = await this.service.list(query);
    return ok({
      items: page.items.map(toResponse),
      nextCursor: page.nextCursor ?? null,
    });
  }

  async getById(req: HttpRequest) {
    const product = await this.service.getById(req.params.id ?? '');
    return ok(toResponse(product));
  }

  async getBySku(req: HttpRequest) {
    const product = await this.service.getBySku(req.params.sku ?? '');
    return ok(toResponse(product));
  }

  async create(req: HttpRequest) {
    requirePermission(requireAuth(req), 'catalog:write');
    const body = parseOrThrow(schemas.createProductSchema, req.body);
    const product = await this.service.create({
      sku: body.sku,
      name: body.name,
      description: body.description,
      category: body.category,
      price: body.price,
      initialStock: body.initialStock,
      status: body.status,
      imageKeys: body.imageKeys,
    });
    return created(toResponse(product), `/products/${product.id}`);
  }

  async update(req: HttpRequest) {
    requirePermission(requireAuth(req), 'catalog:write');
    const body = parseOrThrow(schemas.updateProductSchema, req.body);
    const product = await this.service.update(req.params.id ?? '', body);
    return ok(toResponse(product));
  }

  async archive(req: HttpRequest) {
    requirePermission(requireAuth(req), 'catalog:write');
    await this.service.archive(req.params.id ?? '');
    return noContent();
  }

  async adjustStock(req: HttpRequest) {
    requirePermission(requireAuth(req), 'catalog:write');
    const body = parseOrThrow(schemas.adjustStockSchema, req.body);
    const product = await this.service.adjustStock(req.params.id ?? '', body.delta);
    return ok(toResponse(product));
  }
}

/** Public representation of a product. */
function toResponse(p: Product) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    status: p.status,
    price: {
      amount: p.price.amount,
      currency: p.price.currency,
      display: formatMoney(p.price),
    },
    inventory: {
      available: p.inventory.available,
      reserved: p.inventory.reserved,
    },
    imageKeys: p.imageKeys,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
