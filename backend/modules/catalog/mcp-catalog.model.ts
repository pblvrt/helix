/**
 * Smithery MCP registry proxy.
 *
 * Smithery's public registry API at `https://registry.smithery.ai/servers`
 * returns paginated server listings; `/servers/:qualifiedName` returns the
 * full manifest (including `connections`, which carries the stdio
 * command/args/env or http deploymentUrl we write into `.mcp.json`).
 *
 * We keep this module dumb — parse defensively, don't trust any field, don't
 * crash on missing keys.
 */

import type { CatalogMcp, CatalogMcpDetail, CatalogMcpConnection, CatalogMcpList } from '../../core/types.js';
import type { createHttpCache } from './http-cache.js';
import type { createMcpRepository } from '../mcp/mcp.model.js';

const SMITHERY_BASE = 'https://registry.smithery.ai';
const LIST_TTL_MS = 5 * 60_000;    // 5 min — browsing freshness
const DETAIL_TTL_MS = 30 * 60_000; // 30 min — install manifests rarely change

export interface ListSmitheryParams {
  q?: string;
  page?: number;
  pageSize?: number;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function createMcpCatalog(deps: {
  cache: ReturnType<typeof createHttpCache>;
  mcp: ReturnType<typeof createMcpRepository>;
}) {
  const { cache, mcp } = deps;

  function installedNames(): Set<string> {
    return new Set(mcp.list().map(m => m.name));
  }

  function toCatalogMcp(raw: unknown, installed: Set<string>): CatalogMcp | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const qualifiedName = asString(r.qualifiedName);
    if (!qualifiedName) return null;
    return {
      qualifiedName,
      displayName: asString(r.displayName) || qualifiedName,
      description: asString(r.description),
      iconUrl: asString(r.iconUrl) || null,
      homepage: asString(r.homepage) || null,
      verified: asBool(r.verified),
      useCount: asNumber(r.useCount),
      remote: asBool(r.remote),
      installed: installed.has(qualifiedName),
    };
  }

  function toConnection(raw: unknown): CatalogMcpConnection | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const type = r.type === 'http' || r.type === 'stdio' ? r.type : null;
    if (!type) return null;
    const args = Array.isArray(r.args) ? (r.args as unknown[]).map(String) : undefined;
    const env = r.env && typeof r.env === 'object' && !Array.isArray(r.env)
      ? Object.fromEntries(Object.entries(r.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined;
    const configSchema = r.configSchema && typeof r.configSchema === 'object'
      ? (r.configSchema as Record<string, unknown>)
      : {};
    return {
      type,
      command: asString(r.command) || undefined,
      args,
      env,
      deploymentUrl: asString(r.deploymentUrl) || undefined,
      configSchema,
    };
  }

  return {
    async list(params: ListSmitheryParams = {}): Promise<CatalogMcpList> {
      const page = Math.max(1, Math.floor(params.page ?? 1));
      const pageSize = Math.min(50, Math.max(1, Math.floor(params.pageSize ?? 24)));
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      qs.set('page', String(page));
      qs.set('pageSize', String(pageSize));
      const url = `${SMITHERY_BASE}/servers?${qs.toString()}`;

      const { body, status } = await cache.fetchCached(url, LIST_TTL_MS);
      if (status < 200 || status >= 300) {
        return { entries: [], page, pageSize, totalPages: 0, totalCount: 0 };
      }

      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return { entries: [], page, pageSize, totalPages: 0, totalCount: 0 }; }
      const p = (parsed as Record<string, unknown>) ?? {};
      const installed = installedNames();
      const rawServers = Array.isArray(p.servers) ? (p.servers as unknown[]) : [];
      const entries = rawServers
        .map(r => toCatalogMcp(r, installed))
        .filter((e): e is CatalogMcp => e !== null);

      const pagination = (p.pagination as Record<string, unknown>) ?? {};
      return {
        entries,
        page,
        pageSize,
        totalPages: asNumber(pagination.totalPages, 1),
        totalCount: asNumber(pagination.totalCount, entries.length),
      };
    },

    async get(qualifiedName: string): Promise<CatalogMcpDetail | null> {
      if (!qualifiedName) return null;
      const url = `${SMITHERY_BASE}/servers/${encodeURIComponent(qualifiedName)}`;
      const { body, status } = await cache.fetchCached(url, DETAIL_TTL_MS);
      if (status < 200 || status >= 300) return null;
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return null; }
      const r = (parsed as Record<string, unknown>) ?? {};
      const base = toCatalogMcp(r, installedNames());
      if (!base) return null;
      const rawConnections = Array.isArray(r.connections) ? (r.connections as unknown[]) : [];
      const connections = rawConnections
        .map(toConnection)
        .filter((c): c is CatalogMcpConnection => c !== null);
      return { ...base, connections };
    },
  };
}
