import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

/** Build a minimal API Gateway HTTP API v2 event for handler tests. */
export function makeEvent(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 {
  const rawBody =
    options.body === undefined
      ? undefined
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: new URLSearchParams(options.query ?? {}).toString(),
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
    queryStringParameters: options.query,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'req-' + Math.random().toString(36).slice(2),
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: rawBody,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

export function makeContext(): Context {
  return {
    awsRequestId: 'aws-req-' + Math.random().toString(36).slice(2),
    functionName: 'test-fn',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-fn',
    memoryLimitInMB: '256',
    logGroupName: '/aws/lambda/test-fn',
    logStreamName: 'test',
    callbackWaitsForEmptyEventLoop: true,
    getRemainingTimeInMillis: () => 15_000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

export function parseJsonBody<T = unknown>(body: string | undefined): T {
  return JSON.parse(body ?? '{}') as T;
}
