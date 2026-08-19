import { createRequestContext, runWithContext, getLogger } from '@cloud-commerce/logging';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';

import { dispatch } from '../app';
import { type HttpRequest } from '../http/types';

/**
 * The one file that knows about API Gateway payload shapes (CLAUDE.md §3).
 * Adapts the HTTP API v2 event to the framework-neutral {@link HttpRequest},
 * runs the pipeline, and adapts the response back.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  const headers = lowerCaseHeaders(event.headers);
  const requestContext = createRequestContext({
    headers,
    requestId: context.awsRequestId,
    route: `${event.requestContext.http.method} ${event.requestContext.http.path}`,
  });

  const req: HttpRequest = {
    method: event.requestContext.http.method,
    path: event.rawPath || event.requestContext.http.path || '/',
    headers,
    query: event.queryStringParameters
      ? Object.fromEntries(
          Object.entries(event.queryStringParameters).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        )
      : {},
    params: {},
    body: parseBody(event),
    rawBody: decodeRawBody(event),
    context: requestContext,
  };

  try {
    const res = await dispatch(req);
    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body,
      isBase64Encoded: false,
    };
  } catch (err) {
    // The error-handler middleware catches everything expected; reaching here
    // means the pipeline itself failed. Log with context and return an opaque 500.
    await runWithContext(requestContext, async () => {
      getLogger().fatal({ err }, 'pipeline crashed outside the error handler');
    });
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/problem+json' },
      body: JSON.stringify({
        type: 'internal-error',
        title: 'An unexpected error occurred',
        status: 500,
        correlationId: requestContext.correlationId,
      }),
      isBase64Encoded: false,
    };
  }
}

function lowerCaseHeaders(headers: APIGatewayProxyEventV2['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value !== undefined) out[key.toLowerCase()] = value;
  }
  return out;
}

function decodeRawBody(event: APIGatewayProxyEventV2): string | undefined {
  if (event.body === undefined || event.body === null) return undefined;
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  const raw = decodeRawBody(event);
  if (!raw) return undefined;
  const contentType = (
    event.headers?.['content-type'] ??
    event.headers?.['Content-Type'] ??
    ''
  ).toLowerCase();
  if (
    contentType.includes('application/json') ||
    raw.trimStart().startsWith('{') ||
    raw.trimStart().startsWith('[')
  ) {
    try {
      return JSON.parse(raw);
    } catch {
      return { __unparseable: true };
    }
  }
  return raw;
}
