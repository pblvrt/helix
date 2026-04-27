/**
 * MCP OAuth token refresher.
 *
 * Ticks every 60s, walks `mcp_connections`, and for each row whose
 * `config.oauth.accessToken` is within the refresh window (default 5min of
 * expiry) calls the auth server's token endpoint with the stored refresh
 * token. On success: update the DB row + rewrite `.mcp.json` so the bearer
 * header in `.mcp.json` stays in sync. On failure: persist `lastRefreshError`
 * so the UI can surface a "re-auth required" badge — but don't keep hammering
 * the server (we retry on the next tick, not immediately).
 *
 * The worker is idempotent and self-healing: if a row was refreshed elsewhere
 * (e.g. by another instance of the app), we'll just see a future expiry on
 * the next tick and skip it.
 */

import type { PathConfig } from '../../core/paths.js';
import type { createMcpRepository } from './mcp.model.js';
import type { McpOAuthState } from '../../core/types.js';
import { refreshMcpOAuth } from '../catalog/mcp-oauth-flow.js';
import { writeMcpJson } from './mcp-sync.js';

type McpRepo = ReturnType<typeof createMcpRepository>;

const TICK_MS = 60_000;
const REFRESH_WINDOW_MS = 5 * 60_000;   // refresh anything expiring within 5min

export interface RefresherHandle {
  stop: () => void;
  /** Force a single tick (used by tests and by the IPC "refresh now" button). */
  runOnce: () => Promise<void>;
}

export function startMcpRefresher(opts: { mcp: McpRepo; paths: PathConfig; intervalMs?: number }): RefresherHandle {
  const { mcp, paths } = opts;
  const intervalMs = opts.intervalMs ?? TICK_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (err) {
      console.warn(`[mcp-refresh] tick error: ${(err as Error).message}`);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }

  async function runOnce(): Promise<void> {
    const now = Date.now();
    const rows = mcp.list();
    let refreshed = 0;
    let failed = 0;
    let anyChange = false;

    for (const row of rows) {
      const config = row.config;
      if (!config || typeof config !== 'object') continue;
      const oauth = (config as Record<string, unknown>).oauth as McpOAuthState | undefined;
      if (!oauth || !oauth.refreshToken) continue;

      const expiresAt = Date.parse(oauth.accessTokenExpiresAt);
      if (!Number.isFinite(expiresAt)) continue;
      if (expiresAt - now > REFRESH_WINDOW_MS) continue;

      try {
        const next = await refreshMcpOAuth(oauth);
        const nextConfig = { ...(config as Record<string, unknown>), oauth: next };
        mcp.update(row.id, { config: nextConfig });
        refreshed += 1;
        anyChange = true;
      } catch (err) {
        const msg = (err as Error).message;
        const nextConfig = {
          ...(config as Record<string, unknown>),
          oauth: { ...oauth, lastRefreshError: msg },
        };
        try { mcp.update(row.id, { config: nextConfig }); }
        catch { /* ignore — we'll retry next tick */ }
        console.warn(`[mcp-refresh] ${row.name}: refresh failed — ${msg}`);
        failed += 1;
      }
    }

    if (anyChange) {
      try { writeMcpJson(paths, mcp); }
      catch (err) { console.warn(`[mcp-refresh] writeMcpJson failed: ${(err as Error).message}`); }
    }

    if (refreshed || failed) {
      console.log(`[mcp-refresh] refreshed=${refreshed} failed=${failed}`);
    }
  }

  // Kick off an immediate tick so a fresh boot picks up anything that expired
  // while the app was closed, then schedule the recurring ticks.
  timer = setTimeout(tick, 0);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    runOnce,
  };
}
