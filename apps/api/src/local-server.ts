import { createServer } from 'node:http';

import { createRequestContext, getLogger } from '@cloud-commerce/logging';

import { dispatch } from './app';
import { type HttpRequest } from './http/types';

/**
 * Local HTTP server for development and the frontend's `VITE_API_BASE_URL`.
 * Not used in AWS — Lambda uses `handlers/api.ts`. Kept deliberately minimal.
 */
const PORT = Number(process.env.PORT ?? 4000);
const log = getLogger();

const server = createServer((nodeReq, nodeRes) => {
  const chunks: Buffer[] = [];
  nodeReq.on('data', (c: Buffer) => chunks.push(c));
  nodeReq.on('end', () => {
    void (async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const url = new URL(nodeReq.url ?? '/', `http://localhost:${PORT}`);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(nodeReq.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
        else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(',');
      }

      const req: HttpRequest = {
        method: nodeReq.method ?? 'GET',
        path: url.pathname,
        headers,
        query: Object.fromEntries(url.searchParams.entries()),
        params: {},
        body: rawBody ? safeJson(rawBody) : undefined,
        rawBody: rawBody || undefined,
        context: createRequestContext({ headers, route: `${nodeReq.method} ${url.pathname}` }),
      };

      try {
        const res = await dispatch(req);
        nodeRes.writeHead(res.statusCode, res.headers);
        nodeRes.end(res.body);
      } catch (err) {
        log.error({ err }, 'local server error');
        nodeRes.writeHead(500, { 'content-type': 'application/json' });
        nodeRes.end(JSON.stringify({ error: 'internal' }));
      }
    })();
  });
});

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

server.listen(PORT, () => {
  log.info({ port: PORT }, `cloud-commerce API listening on http://localhost:${PORT}`);
});
