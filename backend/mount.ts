import type { Express, Request, Response } from 'express';
import type { RouteDefinition, StreamRouteDefinition } from './core/router.js';

/** Mount framework-agnostic route definitions onto an Express app */
export function mountRoutes(app: Express, routes: RouteDefinition[]): void {
  for (const { method, path, handler } of routes) {
    app[method](path, async (req: Request, res: Response) => {
      try {
        const result = await handler({
          params: req.params as Record<string, string>,
          query: req.query as Record<string, string>,
          body: req.body,
        });
        res.status(result.status).json(result.data);
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });
  }
}

/** Mount SSE stream routes onto an Express app */
export function mountStreamRoutes(app: Express, streams: StreamRouteDefinition[]): void {
  for (const { method = 'get', path, handler } of streams) {
    app[method](path, (req: Request, res: Response) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      handler(
        { params: req.params as Record<string, string>, query: req.query as Record<string, string>, body: req.body },
        {
          writeEvent: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          end: () => res.end(),
          onClose: (cb) => req.on('close', cb),
        },
      );
    });
  }
}
