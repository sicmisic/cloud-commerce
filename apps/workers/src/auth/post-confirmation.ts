import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { PostgresCustomerRepository } from '@cloud-commerce/database';
import { CustomerService } from '@cloud-commerce/domain';
import { createRequestContext, getLogger, runWithContext } from '@cloud-commerce/logging';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';

/**
 * Cognito PostConfirmation trigger. When a user confirms their sign-up we:
 *  1. add them to the default `CUSTOMER` group, and
 *  2. provision their customer row in PostgreSQL, linked to the Cognito `sub`.
 *
 * Both steps are idempotent — Cognito may invoke the trigger more than once.
 * The trigger must return the event unchanged or Cognito fails the sign-up, so
 * a provisioning failure is logged and swallowed (a reconciliation job / the
 * first `POST /customers` call covers the gap).
 */

let cognito: CognitoIdentityProviderClient | undefined;
let customerService: CustomerService | undefined;

export async function handler(
  event: PostConfirmationTriggerEvent,
): Promise<PostConfirmationTriggerEvent> {
  const ctx = createRequestContext({ requestId: event.request.userAttributes.sub });

  await runWithContext(ctx, async () => {
    const log = getLogger().child({ trigger: 'post-confirmation' });
    const attrs = event.request.userAttributes;
    const sub = attrs.sub ?? event.userName;
    const email = attrs.email ?? '';
    const name = attrs.name ?? attrs.given_name ?? email;

    try {
      cognito ??= new CognitoIdentityProviderClient({});
      await cognito.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: event.userPoolId,
          Username: event.userName,
          GroupName: 'CUSTOMER',
        }),
      );

      if (email) {
        customerService ??= new CustomerService(new PostgresCustomerRepository());
        await customerService.register({ email, name, authSubject: sub });
      }

      log.info({ sub }, 'customer provisioned on sign-up confirmation');
    } catch (err) {
      log.error({ err, sub }, 'post-confirmation provisioning failed — will reconcile later');
    }
  });

  return event;
}
