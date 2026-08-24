import { requirePermission, type Principal } from '@cloud-commerce/auth';
import {
  ConflictError,
  ForbiddenError,
  format as formatMoney,
  type OrderView,
} from '@cloud-commerce/domain';
import {
  paginationQuery,
  parseOrThrow,
  schemas,
  ValidationFailure,
} from '@cloud-commerce/validation';

import { getCustomerService, getOrderService } from '../container';
import { accepted, created, ok } from '../http/response';
import { type HttpRequest } from '../http/types';
import { requireAuth } from '../middleware/auth';

/**
 * Thin order controller. Validates (Zod), resolves the caller's customer,
 * enforces ownership, and calls {@link OrderService}. All orchestration
 * (inventory reservation, persistence, event fan-out) lives in the service.
 */
export class OrderController {
  async create(req: HttpRequest) {
    const principal = requireAuth(req);
    requirePermission(principal, 'order:create');

    const body = parseOrThrow(schemas.createOrderSchema, req.body);
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
      throw new ValidationFailure([
        { path: 'Idempotency-Key', message: 'this header is required for POST /orders (ADR 004)' },
      ]);
    }
    parseOrThrow(schemas.idempotencyKey, idempotencyKey);

    const customer = await this.resolveCustomer(principal);

    const order = await getOrderService().createOrder({
      customerId: customer.id,
      correlationId: req.context.correlationId,
      idempotencyKey,
      lines: body.lines,
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress ?? body.shippingAddress,
    });
    return created(toResponse(order), `/orders/${order.id}`);
  }

  async getById(req: HttpRequest) {
    const principal = requireAuth(req);
    const order = await getOrderService().getOrder(req.params.id ?? '');
    await this.assertCanRead(principal, order.customerId);
    return ok(toResponse(order));
  }

  async listForCustomer(req: HttpRequest) {
    const principal = requireAuth(req);
    const customerId = req.params.id ?? '';
    await this.assertCanRead(principal, customerId);
    const query = parseOrThrow(paginationQuery, req.query);
    const page = await getOrderService().listCustomerOrders(customerId, query);
    return ok({ items: page.items.map(summaryResponse), nextCursor: page.nextCursor ?? null });
  }

  async cancel(req: HttpRequest) {
    const principal = requireAuth(req);
    requirePermission(principal, 'order:cancel:any');
    const body = parseOrThrow(schemas.cancelOrderSchema, req.body ?? {});
    const order = await getOrderService().cancelOrder(
      req.params.id ?? '',
      body.reason,
      req.context.correlationId,
    );
    return accepted(toResponse(order));
  }

  private async resolveCustomer(principal: Principal) {
    const customer = await getCustomerService().findByAuthSubject(principal.userId);
    if (!customer) {
      throw new ConflictError('register a customer profile before placing an order', {
        hint: 'POST /customers',
      });
    }
    return customer;
  }

  private async assertCanRead(principal: Principal, ownerCustomerId: string): Promise<void> {
    if (principal.permissions.has('order:read:any')) return;
    const customer = await getCustomerService().findByAuthSubject(principal.userId);
    if (!customer || customer.id !== ownerCustomerId) {
      throw new ForbiddenError('you can only view your own orders');
    }
  }
}

function toResponse(o: OrderView) {
  return {
    id: o.id,
    customerId: o.customerId,
    status: o.status,
    currency: o.currency,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      unitPrice: i.unitPrice.amount,
      quantity: i.quantity,
      lineTotal: i.lineTotal.amount,
    })),
    subtotal: o.subtotal.amount,
    tax: o.tax.amount,
    shippingFee: o.shippingFee.amount,
    total: o.total.amount,
    totalDisplay: formatMoney(o.total),
    shippingAddress: o.shippingAddress,
    billingAddress: o.billingAddress,
    payments: o.payments.map((p) => ({ id: p.id, status: p.status, amount: p.amount.amount })),
    shipments: o.shipments.map((s) => ({
      id: s.id,
      status: s.status,
      trackingNumber: s.trackingNumber ?? null,
    })),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

function summaryResponse(s: {
  id: string;
  status: string;
  total: { amount: number; currency: string };
  itemCount: number;
  createdAt: string;
}) {
  return {
    id: s.id,
    status: s.status,
    total: s.total.amount,
    totalDisplay: formatMoney(s.total),
    itemCount: s.itemCount,
    createdAt: s.createdAt,
  };
}
