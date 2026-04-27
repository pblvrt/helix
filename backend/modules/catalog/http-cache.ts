/**
 * http-cache — thin fetch wrapper with a SQLite-backed body cache.
 *
 * Used by the catalog proxies (Smithery, skills.sh). The registries are
 * untrusted and sometimes slow or rate-limited; we cache JSON/HTML responses
 * by URL with a per-call TTL and fall back to the stale entry on network
 * failure. Shape is intentionally minimal — no ETag/If-Modified-Since, no
 * content-negotiation, no streaming. Callers parse the body themselves.
 *
 * Concurrency: no in-flight deduplication. If two requests race for the same
 * URL, both will hit the network. Cheap to add if it becomes a problem.
 */

import type Database from 'better-sqlite3';

export interface CachedResponse {
  body: string;
  status: number;
  fromCache: boolean;
}

export interface FetchCachedOptions {
  /** Extra headers sent on the underlying fetch (merged with defaults). */
  headers?: Record<string, string>;
  /** Ignore existing cache entry and force a refresh. Default false. */
  force?: boolean;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'seo-automator/0.1 (+catalog-proxy)',
  'Accept-Language': 'en-US,en;q=0.9',
};

export function createHttpCache(db: Database.Database) {
  // Best-effort janitor: drop rows that expired long ago so the table
  // doesn't grow unbounded. Not on a timer — we prune lazily on reads.
  function pruneExpiredOlderThan(hours: number): void {
    db.prepare(`
      DELETE FROM http_cache
      WHERE datetime(expires_at) < datetime('now', '-' || ? || ' hours')
    `).run(hours);
  }

  function readCached(url: string): { body: string; status: number; expiresAt: string } | null {
    const row = db.prepare(
      'SELECT body, status, expires_at AS expiresAt FROM http_cache WHERE url = ?'
    ).get(url) as { body: string; status: number; expiresAt: string } | undefined;
    return row ?? null;
  }

  function writeCached(url: string, body: string, status: number, ttlMs: number): void {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    db.prepare(`
      INSERT INTO http_cache (url, body, status, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET body = excluded.body, status = excluded.status, expires_at = excluded.expires_at
    `).run(url, body, status, expiresAt);
  }

  return {
    async fetchCached(url: string, ttlMs: number, opts: FetchCachedOptions = {}): Promise<CachedResponse> {
      const cached = readCached(url);
      const now = Date.now();
      const valid = cached && new Date(cached.expiresAt).getTime() > now;
      if (valid && !opts.force) {
        return { body: cached.body, status: cached.status, fromCache: true };
      }

      try {
        const res = await fetch(url, { headers: { ...DEFAULT_HEADERS, ...opts.headers } });
        const body = await res.text();
        if (res.ok) {
          writeCached(url, body, res.status, ttlMs);
        }
        // Prune aggressively-expired entries occasionally (1 in ~20 requests
        // on average). Cheap on a small table.
        if (Math.random() < 0.05) pruneExpiredOlderThan(24);
        return { body, status: res.status, fromCache: false };
      } catch (err) {
        // Network failure — if we have ANY cache entry (even expired), serve
        // it as a graceful fallback. The UI shows "registry unreachable"
        // styling via a warning header in catalog.controller if needed.
        if (cached) {
          return { body: cached.body, status: cached.status, fromCache: true };
        }
        throw err;
      }
    },

    /** Invalidate a single URL (used after an install, etc.). */
    invalidate(url: string): void {
      db.prepare('DELETE FROM http_cache WHERE url = ?').run(url);
    },
  };
}
