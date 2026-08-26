import { getConfig } from '@cloud-commerce/config';
import {
  DynamoIdempotencyStore,
  DynamoProductRepository,
  PostgresCustomerRepository,
  PostgresOrderRepository,
} from '@cloud-commerce/database';
import {
  CatalogService,
  InventoryReleaser,
  NotificationSender,
  PaymentProcessor,
  ShipmentProcessor,
  type CustomerRepository,
  type EventPublisher,
  type IdempotencyStore,
  type OrderRepository,
  type ProductRepository,
} from '@cloud-commerce/domain';
import { EventBridgeEventPublisher } from '@cloud-commerce/events';
import {
  MockEmailProvider,
  MockPaymentProvider,
  MockShippingProvider,
} from '@cloud-commerce/integrations';
import { logger } from '@cloud-commerce/logging';

/**
 * Worker composition root. Same idea as the API container — lazy singletons
 * from config, overridable in tests.
 */

interface Container {
  products?: ProductRepository;
  customers?: CustomerRepository;
  orders?: OrderRepository;
  events?: EventPublisher;
  idempotency?: IdempotencyStore;
  payment?: PaymentProcessor;
  shipment?: ShipmentProcessor;
  notifications?: NotificationSender;
  inventory?: InventoryReleaser;
}

const c: Container = {};

const cfg = () => getConfig();

function products(): ProductRepository {
  return (c.products ??= new DynamoProductRepository({
    tableName: cfg().dynamodb.catalogTableName,
  }));
}
function customers(): CustomerRepository {
  return (c.customers ??= new PostgresCustomerRepository());
}
function orders(): OrderRepository {
  return (c.orders ??= new PostgresOrderRepository());
}
function events(): EventPublisher {
  return (c.events ??= new EventBridgeEventPublisher({
    eventBusName: cfg().messaging.eventBusName,
  }));
}
function idempotency(): IdempotencyStore {
  return (c.idempotency ??= new DynamoIdempotencyStore(cfg().dynamodb.idempotencyTableName));
}

const paymentFaultRate = () => cfg().providers.paymentMockFailureRate;

export function paymentProcessor(): PaymentProcessor {
  return (c.payment ??= new PaymentProcessor({
    orders: orders(),
    provider: new MockPaymentProvider({ serverErrorRate: paymentFaultRate() }),
    events: events(),
    idempotency: idempotency(),
    idempotencyTtlSeconds: cfg().dynamodb.idempotencyTtlSeconds,
    logger: logger('PaymentProcessor'),
  }));
}

export function shipmentProcessor(): ShipmentProcessor {
  return (c.shipment ??= new ShipmentProcessor({
    orders: orders(),
    provider: new MockShippingProvider(),
    events: events(),
    idempotency: idempotency(),
    logger: logger('ShipmentProcessor'),
  }));
}

export function notificationSender(): NotificationSender {
  return (c.notifications ??= new NotificationSender({
    provider: new MockEmailProvider(),
    customers: customers(),
    idempotency: idempotency(),
    logger: logger('NotificationSender'),
  }));
}

export function inventoryReleaser(): InventoryReleaser {
  return (c.inventory ??= new InventoryReleaser({
    catalog: new CatalogService(products()),
    idempotency: idempotency(),
    logger: logger('InventoryReleaser'),
  }));
}

export function __setWorkerContainer(overrides: Partial<Container>): void {
  Object.assign(c, overrides);
}

export function __resetWorkerContainer(): void {
  for (const key of Object.keys(c) as (keyof Container)[]) delete c[key];
}
