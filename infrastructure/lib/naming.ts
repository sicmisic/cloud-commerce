import { type EnvName } from '../config/environments';

/** Consistent, predictable resource names: `cloud-commerce-<resource>-<env>`. */
export function resourceName(resource: string, env: EnvName): string {
  return `cloud-commerce-${resource}-${env}`;
}

export function stackName(stack: string, env: EnvName): string {
  return `CloudCommerce-${stack}-${env}`;
}

export const APP_NAME = 'cloud-commerce';
