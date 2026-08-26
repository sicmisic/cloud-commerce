import { getConfig } from '@cloud-commerce/config';
import {
  DynamoIdempotencyStore,
  DynamoProductRepository,
  PostgresCustomerRepository,
  PostgresOrderRepository,
} from '@cloud-commerce/database';
import {
  CatalogService,
  CustomerService,
  OrderService,
  type CustomerRepository,
  type EventPublisher,
  type IdempotencyStore,
  type OrderRepository,
  type ProductRepository,
} from '@cloud-commerce/domain';
import {
  DlqAdmin,
  type DlqAdminPort,
  EventBridgeEventPublisher,
  InMemoryEventPublisher,
} from '@cloud-commerce/events';
import { logger } from '@cloud-commerce/logging';

/**
 * Composition root. Wires application services to their adapters based on
 * config, once per warm container. Tests override the ports via
 * {@link __setContainer} instead of standing up AWS / Postgres.
 */

interface Container {
  productRepository?: ProductRepository;
  customerRepository?: CustomerRepository;
  orderRepository?: OrderRepository;
  eventPublisher?: EventPublisher;
  idempotencyStore?: IdempotencyStore;
  catalogService?: CatalogService;
  customerService?: CustomerService;
  orderService?: OrderService;
  dlqAdmin?: DlqAdminPort;
}

const c: Container = {};

export function getProductRepository(): ProductRepository {
  c.productRepository ??= new DynamoProductRepository({
    tableName: getConfig().dynamodb.catalogTableName,
  });
  return c.productRepository;
}

export function getCustomerRepository(): CustomerRepository {
  c.customerRepository ??= new PostgresCustomerRepository();
  return c.customerRepository;
}

export function getOrderRepository(): OrderRepository {
  c.orderRepository ??= new PostgresOrderRepository();
  return c.orderRepository;
}

export function getEventPublisher(): EventPublisher {
  if (!c.eventPublisher) {
    const { messaging } = getConfig();
    c.eventPublisher = new EventBridgeEventPublisher({ eventBusName: messaging.eventBusName });
  }
  return c.eventPublisher;
}

export function getIdempotencyStore(): IdempotencyStore {
  c.idempotencyStore ??= new DynamoIdempotencyStore(getConfig().dynamodb.idempotencyTableName);
  return c.idempotencyStore;
}

export function getDlqAdmin(): DlqAdminPort {
  c.dlqAdmin ??= new DlqAdmin(
    getConfig().messaging.dlqQueues.map((q) => ({
      name: q.name,
      dlqUrl: q.dlqUrl,
      dlqArn: q.dlqArn,
    })),
  );
  return c.dlqAdmin;
}

export function getCatalogService(): CatalogService {
  c.catalogService ??= new CatalogService(getProductRepository());
  return c.catalogService;
}

export function getCustomerService(): CustomerService {
  c.customerService ??= new CustomerService(getCustomerRepository());
  return c.customerService;
}

export function getOrderService(): OrderService {
  c.orderService ??= new OrderService({
    customers: getCustomerRepository(),
    catalog: getCatalogService(),
    orders: getOrderRepository(),
    events: getEventPublisher(),
    paymentProviderName: getConfig().providers.payment,
    logger: logger('OrderService'),
  });
  return c.orderService;
}

/** Test seam — inject fakes. Any service left unset is rebuilt lazily from the
 * (also overridable) repositories. */
export function __setContainer(overrides: Partial<Container>): void {
  Object.assign(c, overrides);
  // Rebuild derived services so they pick up injected repositories.
  if (overrides.productRepository && !overrides.catalogService) c.catalogService = undefined;
  if (overrides.customerRepository && !overrides.customerService) c.customerService = undefined;
  if (
    (overrides.orderRepository || overrides.eventPublisher || overrides.productRepository) &&
    !overrides.orderService
  ) {
    c.orderService = undefined;
  }
}

export function __resetContainer(): void {
  for (const key of Object.keys(c) as (keyof Container)[]) delete c[key];
}

/** For tests that need to assert on published events. */
export function __installInMemoryEventPublisher(): InMemoryEventPublisher {
  const publisher = new InMemoryEventPublisher();
  __setContainer({ eventPublisher: publisher });
  return publisher;
}
