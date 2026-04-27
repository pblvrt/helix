import type { RouteDefinition } from '../../core/router.js';
import type { PathConfig } from '../../core/paths.js';
import type { createMcpRepository } from './mcp.model.js';
import { writeMcpJson } from './mcp-sync.js';

/**
 * Every mutation materialises `.mcp.json` so Claude Code sees the change on
 * the next agent spawn. Failures to write the file are logged but do NOT
 * reject the HTTP response — the DB is the source of truth; the file is a
 * cache that will self-heal on the next mutation.
 */
export function createMcpController(deps: {
  mcp: ReturnType<typeof createMcpRepository>;
  paths: PathConfig;
}): RouteDefinition[] {
  const { mcp, paths } = deps;

  function syncFile(): void {
    try { writeMcpJson(paths, mcp); }
    catch (err) { console.warn(`[mcp.controller] writeMcpJson failed: ${(err as Error).message}`); }
  }

  return [
    { method: 'get', path: '/api/mcp-connections', handler: () => ({ status: 200, data: mcp.list() }) },
    {
      method: 'get', path: '/api/mcp-connections/:id',
      handler: ({ params }) => {
        const c = mcp.get(params.id);
        return c ? { status: 200, data: c } : { status: 404, data: { error: 'Connection not found' } };
      },
    },
    {
      method: 'post', path: '/api/mcp-connections',
      handler: ({ body }) => {
        const data = body as { name?: string; url?: string; config?: Record<string, unknown> };
        if (!data.name?.trim()) return { status: 400, data: { error: 'name is required' } };
        const created = mcp.create({ name: data.name, url: data.url, config: data.config });
        syncFile();
        return { status: 201, data: created };
      },
    },
    {
      method: 'patch', path: '/api/mcp-connections/:id',
      handler: ({ params, body }) => {
        const c = mcp.update(params.id, body as any);
        if (!c) return { status: 404, data: { error: 'Connection not found' } };
        syncFile();
        return { status: 200, data: c };
      },
    },
    {
      method: 'delete', path: '/api/mcp-connections/:id',
      handler: ({ params }) => {
        const result = mcp.delete(params.id);
        syncFile();
        return { status: 200, data: result };
      },
    },
    {
      method: 'get', path: '/api/goals/:id/mcp-connections',
      handler: ({ params }) => ({ status: 200, data: mcp.listForGoal(params.id) }),
    },
    {
      method: 'put', path: '/api/goals/:id/mcp-connections',
      handler: ({ params, body }) => {
        const ids = ((body as { mcpIds?: unknown }).mcpIds ?? []) as unknown;
        if (!Array.isArray(ids)) return { status: 400, data: { error: 'mcpIds must be an array' } };
        mcp.setForGoal(params.id, ids.map(String));
        return { status: 200, data: mcp.listForGoal(params.id) };
      },
    },
  ];
}
