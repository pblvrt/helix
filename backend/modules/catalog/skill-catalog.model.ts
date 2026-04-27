/**
 * skills.sh proxy — the site has no JSON API, so we work from:
 *   1. `https://skills.sh/sitemap.xml`   — enumerates every indexed skill
 *      via URLs of the form `/:owner/:repo/:slug`.
 *   2. `https://skills.sh/:owner/:repo/:slug` — per-skill page; we parse the
 *      embedded `__NEXT_DATA__` script tag (Next.js SSR payload) to pull
 *      description / install count / stars.
 *
 * Lazy: `list()` only returns identity fields (owner/repo/slug/displayName).
 * Rich metadata is pulled on demand via `get()` when the user hovers/clicks a
 * card, so a 1000-entry sitemap doesn't fan out to 1000 fetches.
 */

import fs from 'fs';
import type { CatalogSkill, CatalogSkillList } from '../../core/types.js';
import type { PathConfig } from '../../core/paths.js';
import type { createHttpCache } from './http-cache.js';

const SKILLS_SH_BASE = 'https://skills.sh';
const SITEMAP_TTL_MS = 24 * 60 * 60_000; // 24h
const DETAIL_TTL_MS  = 24 * 60 * 60_000; // 24h

export interface ListSkillsParams {
  q?: string;
  org?: string;
  page?: number;
  pageSize?: number;
}

interface SitemapEntry {
  owner: string;
  repo: string;
  slug: string;
  displayName: string;
}

/**
 * Extract `/:owner/:repo/:slug` URLs from the sitemap XML. We don't pull in
 * an XML parser — the format is regular enough that a scoped regex works and
 * won't die on whitespace variations.
 */
function parseSitemap(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const locRe = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = locRe.exec(xml)) !== null) {
    const url = m[1];
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 3) continue;
    const [owner, repo, slug] = parts;
    // Skip weird paths (root pages or tool URLs)
    if (!/^[A-Za-z0-9._-]+$/.test(owner)) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(slug)) continue;
    entries.push({ owner, repo, slug, displayName: slug });
  }
  return entries;
}

/**
 * Best-effort `__NEXT_DATA__` parse. skills.sh is a Next.js app; each page
 * ships its SSR props in an inlined `<script id="__NEXT_DATA__">…</script>`.
 * We fish out the first matching JSON block and look for likely fields. If
 * the layout changes, this gracefully returns nulls and the UI just shows
 * the fallback values from the sitemap (name + slug).
 */
function parseNextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Walk the Next payload looking for the first object that smells like the
 * skill detail — has `description` and `installCount` or `stars`. Structure
 * varies; this is intentionally permissive.
 */
function pickSkillMetadata(payload: unknown): { description: string; installCount: number | null; githubStars: number | null; iconUrl: string | null } {
  const fallback = { description: '', installCount: null, githubStars: null, iconUrl: null };
  if (!payload || typeof payload !== 'object') return fallback;
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const r = node as Record<string, unknown>;
    const desc = asString(r.description) ?? asString(r.summary) ?? asString(r.readme);
    const installs = asNumber(r.installCount) ?? asNumber(r.installs) ?? asNumber(r.weeklyInstalls);
    const stars = asNumber(r.stargazersCount) ?? asNumber(r.stars) ?? asNumber(r.githubStars);
    const icon = asString(r.iconUrl) ?? asString(r.icon);
    if (desc || installs !== null || stars !== null) {
      return {
        description: desc ?? '',
        installCount: installs,
        githubStars: stars,
        iconUrl: icon,
      };
    }
    for (const v of Object.values(r)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return fallback;
}

export function createSkillCatalog(deps: {
  cache: ReturnType<typeof createHttpCache>;
  paths: PathConfig;
}) {
  const { cache, paths } = deps;

  function installedSlugs(): Set<string> {
    if (!fs.existsSync(paths.skillsDir)) return new Set();
    return new Set(
      fs.readdirSync(paths.skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    );
  }

  async function allSitemapEntries(): Promise<SitemapEntry[]> {
    const { body, status } = await cache.fetchCached(
      `${SKILLS_SH_BASE}/sitemap.xml`,
      SITEMAP_TTL_MS,
      { headers: { Accept: 'application/xml,text/xml;q=0.9' } }
    );
    if (status < 200 || status >= 300) return [];
    return parseSitemap(body);
  }

  return {
    async list(params: ListSkillsParams = {}): Promise<CatalogSkillList> {
      const page = Math.max(1, Math.floor(params.page ?? 1));
      const pageSize = Math.min(60, Math.max(1, Math.floor(params.pageSize ?? 24)));

      let entries = await allSitemapEntries();

      if (params.org) {
        const needle = params.org.toLowerCase();
        entries = entries.filter(e => e.owner.toLowerCase() === needle);
      }
      if (params.q) {
        const needle = params.q.toLowerCase();
        entries = entries.filter(e =>
          e.slug.toLowerCase().includes(needle) ||
          e.repo.toLowerCase().includes(needle) ||
          e.owner.toLowerCase().includes(needle)
        );
      }

      const totalCount = entries.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const slice = entries.slice((page - 1) * pageSize, page * pageSize);
      const installed = installedSlugs();

      const out: CatalogSkill[] = slice.map(e => ({
        owner: e.owner,
        repo: e.repo,
        slug: e.slug,
        displayName: e.slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        iconUrl: null,
        installCount: null,
        githubStars: null,
        installed: installed.has(e.slug),
      }));

      return { entries: out, page, pageSize, totalPages, totalCount };
    },

    async get(owner: string, repo: string, slug: string): Promise<CatalogSkill | null> {
      if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo) || !/^[A-Za-z0-9._-]+$/.test(slug)) {
        return null;
      }
      const url = `${SKILLS_SH_BASE}/${owner}/${repo}/${slug}`;
      const { body, status } = await cache.fetchCached(url, DETAIL_TTL_MS, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (status < 200 || status >= 300) return null;
      const payload = parseNextData(body);
      const meta = pickSkillMetadata(payload);
      const installed = installedSlugs();
      return {
        owner,
        repo,
        slug,
        displayName: slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: meta.description,
        iconUrl: meta.iconUrl,
        installCount: meta.installCount,
        githubStars: meta.githubStars,
        installed: installed.has(slug),
      };
    },

    installedSlugs,
  };
}
