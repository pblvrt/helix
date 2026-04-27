/**
 * Raw HTTP adapter — mounts framework-agnostic route definitions onto http.createServer.
 * Replaces the 270-line hand-rolled URL matching in electron/main.ts.
 */

import http from 'http';
import type { RouteDefinition, StreamRouteDefinition } from '../backend/core/router.js';

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function jsonResp(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

/** Convert Express-style path to regex, e.g. '/api/leads/:id' -> /^\/api\/leads\/([^/]+)$/ */
function pathToRegex(routePath: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = routePath.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

interface CompiledRoute {
  method: string;
  regex: RegExp;
  paramNames: string[];
  handler: RouteDefinition['handler'];
}

interface CompiledStreamRoute {
  method: string;
  regex: RegExp;
  paramNames: string[];
  handler: StreamRouteDefinition['handler'];
}

export function createHttpServer(
  routes: RouteDefinition[],
  extraHandler?: (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<boolean>,
  streamRoutes: StreamRouteDefinition[] = [],
): http.Server {
  // Pre-compile all route regexes
  const compiled: CompiledRoute[] = routes.map(({ method, path, handler }) => {
    const { regex, paramNames } = pathToRegex(path);
    return { method: method.toUpperCase(), regex, paramNames, handler };
  });

  const compiledStream: CompiledStreamRoute[] = streamRoutes.map(({ method = 'get', path, handler }) => {
    const { regex, paramNames } = pathToRegex(path);
    return { method: method.toUpperCase(), regex, paramNames, handler };
  });

  return http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // Let extra handler process first (for SSE streams, etc.)
    if (extraHandler) {
      const handled = await extraHandler(req, res, url);
      if (handled) return;
    }

    try {
      // Try SSE stream routes first (they may share paths with JSON routes).
      for (const route of compiledStream) {
        if (route.method !== method) continue;
        const match = pathname.match(route.regex);
        if (!match) continue;

        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
        const query: Record<string, string> = {};
        url.searchParams.forEach((v, k) => { query[k] = v; });
        const body = method !== 'GET' ? await parseBody(req) : {};

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        route.handler({ params, query, body }, {
          writeEvent: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          end: () => res.end(),
          onClose: (cb) => req.on('close', cb),
        });
        return;
      }

      for (const route of compiled) {
        if (route.method !== method) continue;
        const match = pathname.match(route.regex);
        if (!match) continue;

        // Extract params
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });

        // Extract query
        const query: Record<string, string> = {};
        url.searchParams.forEach((v, k) => { query[k] = v; });

        // Parse body for non-GET methods
        const body = method !== 'GET' ? await parseBody(req) : {};

        const result = await route.handler({ params, query, body });
        jsonResp(res, result.data, result.status);
        return;
      }

      jsonResp(res, { error: 'Not found' }, 404);
    } catch (err) {
      console.error('API error:', err);
      jsonResp(res, { error: String(err) }, 500);
    }
  });
}
