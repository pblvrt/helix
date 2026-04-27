/**
 * mcp-sync — one-way materialisation of `mcp_connections` rows into `.mcp.json`.
 *
 * `.mcp.json` is what Claude Code actually reads when spawning agents. The DB
 * table is the user-facing source of truth (CRUD via /#/mcp + catalog
 * installs). Every MCP mutation (create / update / delete / catalog install)
 * must call `writeMcpJson` so the two stay aligned.
 *
 * On first boot, `importMcpJsonIfEmpty` imports any hand-edited entries from
 * `.mcp.json` into the DB so the user doesn't lose existing setup (mirrors the
 * knowledge-seed pattern).
 */

import fs from 'fs';
import path from 'path';
import type { PathConfig } from '../../core/paths.js';
import type { createMcpRepository } from './mcp.model.js';
import type { McpOAuthState } from '../../core/types.js';

type McpRepo = ReturnType<typeof createMcpRepository>;

/** Shape we produce for .mcp.json. Each value is the user's `config` JSON blob. */
interface McpJsonFile {
  mcpServers: Record<string, Record<string, unknown>>;
}

/**
 * Strip the `oauth` state block from a DB-stored config and overlay the
 * bearer header so `.mcp.json` consumers (Claude Code, etc.) see a clean
 * HTTP MCP with a working Authorization header. Refresh tokens + endpoints
 * stay in the DB — our refresher re-mints this header on rotation.
 */
export function projectConfigForMcpJson(config: Record<string, unknown>): Record<string, unknown> {
  const { oauth, ...rest } = config as Record<string, unknown> & { oauth?: McpOAuthState };
  if (!oauth || typeof oauth !== 'object') return rest;
  const existingHeaders = (rest.headers && typeof rest.headers === 'object')
    ? rest.headers as Record<string, string>
    : {};
  const tokenType = oauth.tokenType || 'Bearer';
  return {
    ...rest,
    headers: { ...existingHeaders, Authorization: `${tokenType} ${oauth.accessToken}` },
  };
}

/**
 * Serialize the full `mcp_connections` table into `.mcp.json`, atomically.
 * Atomic = write to a tmp file, fsync, rename — so a crash mid-write can't
 * leave the file blank or partial.
 */
export function writeMcpJson(paths: PathConfig, mcp: McpRepo): void {
  const entries = mcp.list();
  const out: McpJsonFile = { mcpServers: {} };
  for (const entry of entries) {
    // The `config` JSON blob *is* the mcp-server config; we key it by `name`.
    // Empty configs and missing names are skipped rather than producing an
    // invalid `.mcp.json`.
    if (!entry.name || !entry.config || typeof entry.config !== 'object') continue;
    out.mcpServers[entry.name] = projectConfigForMcpJson(entry.config as Record<string, unknown>);
  }

  const target = paths.mcpJsonPath;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, target);
}

/**
 * Serialize a subset of `mcp_connections` into a scoped MCP config file,
 * suitable for passing to `claude --mcp-config <path>`. This is how a goal's
 * linked MCP servers become the actual gate: the Claude process invoked for
 * a goal's action only sees the servers listed here, not the global `.mcp.json`.
 *
 * Returns the path written, or null if no MCPs matched (caller should then
 * skip the `--mcp-config` flag and let Claude Code fall back to the global
 * file — which for a standalone run is fine, but for a goal means "no MCPs").
 */
export function writeScopedMcpJson(
  targetPath: string,
  mcp: McpRepo,
  mcpIds: string[],
): string | null {
  const idSet = new Set(mcpIds);
  const all = mcp.list();
  const entries = all.filter(e => idSet.has(e.id));
  if (!entries.length) return null;

  const out: McpJsonFile = { mcpServers: {} };
  for (const entry of entries) {
    if (!entry.name || !entry.config || typeof entry.config !== 'object') continue;
    out.mcpServers[entry.name] = projectConfigForMcpJson(entry.config as Record<string, unknown>);
  }
  if (!Object.keys(out.mcpServers).length) return null;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, targetPath);
  return targetPath;
}

/**
 * One-shot migration: when the DB is empty, seed it from `.mcp.json` (or, on
 * a fresh clone where the real file isn't tracked, `.mcp.json.example`).
 *
 * Idempotent — if the DB already has any rows, does nothing. (To re-import,
 * clear the table first.)
 */
export function importMcpJsonIfEmpty(paths: PathConfig, mcp: McpRepo): void {
  const existing = mcp.list();
  if (existing.length > 0) return;

  // Prefer the real .mcp.json (user's current state), fall back to the
  // checked-in example so a fresh clone gets a sane chrome-devtools baseline.
  const candidates = [paths.mcpJsonPath, `${paths.mcpJsonPath}.example`];
  const sourcePath = candidates.find(p => fs.existsSync(p));
  if (!sourcePath) return;

  let parsed: McpJsonFile;
  try {
    const text = fs.readFileSync(sourcePath, 'utf-8');
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn(`[mcp-sync] Failed to parse ${sourcePath}: ${(err as Error).message}`);
    return;
  }
  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== 'object') return;

  let imported = 0;
  for (const [name, config] of Object.entries(servers)) {
    if (!name || !config || typeof config !== 'object') continue;
    try {
      mcp.create({ name, url: '', config: config as Record<string, unknown> });
      imported += 1;
    } catch (err) {
      console.warn(`[mcp-sync] Skipped import of "${name}": ${(err as Error).message}`);
    }
  }
  if (imported > 0) {
    console.log(`[mcp-sync] Imported ${imported} MCP server(s) from ${sourcePath} into the database.`);
  }
}
