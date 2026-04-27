/**
 * Knowledge = durable facts, voice guides, and reference data that outlive any
 * single run (product profile, tone rules, seed lists, ops docs). It is NOT
 * the place for per-run intent — that's `goals.context` / `task.payload.goalContext`,
 * which the planner writes onto each task and the executor forwards to the
 * subagent. If you catch yourself putting voice guidance into a goal's context,
 * or per-run instructions into a knowledge entry, the line has drifted — move it.
 */

import type Database from 'better-sqlite3';
import { knowledgeToCamel, KNOWLEDGE_FIELDS } from '../../core/transforms.js';
import type { Knowledge, KnowledgeContentType } from '../../core/types.js';

type Row = Record<string, unknown>;

export interface CreateKnowledgeInput {
  slug: string;
  title: string;
  collection?: string;
  tags?: string[];
  content?: string;
  contentType?: KnowledgeContentType;
  source?: string | null;
}

export interface UpdateKnowledgeInput {
  slug?: string;
  title?: string;
  collection?: string;
  tags?: string[];
  content?: string;
  contentType?: KnowledgeContentType;
  source?: string | null;
}

export interface ListKnowledgeOptions {
  collection?: string;
  tag?: string;
  q?: string;
}

export interface KnowledgeConflictError extends Error {
  code: 'SLUG_CONFLICT';
}

function slugConflict(slug: string): KnowledgeConflictError {
  const err = new Error(`Knowledge entry with slug "${slug}" already exists`) as KnowledgeConflictError;
  err.code = 'SLUG_CONFLICT';
  return err;
}

export function createKnowledgeRepository(db: Database.Database) {
  function rowBySlug(slug: string): Row | undefined {
    return db.prepare('SELECT * FROM knowledge WHERE slug = ?').get(slug) as Row | undefined;
  }

  return {
    list(opts: ListKnowledgeOptions = {}): Knowledge[] {
      const where: string[] = [];
      const params: unknown[] = [];
      if (opts.collection) { where.push('collection = ?'); params.push(opts.collection); }
      if (opts.tag)        { where.push("tags LIKE ?");    params.push(`%"${opts.tag}"%`); }
      if (opts.q) {
        where.push('(title LIKE ? OR content LIKE ? OR slug LIKE ?)');
        const needle = `%${opts.q}%`;
        params.push(needle, needle, needle);
      }
      const sql = `SELECT * FROM knowledge${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                   ORDER BY collection ASC, title ASC`;
      return db.prepare(sql).all(...params).map(r => knowledgeToCamel(r as Row));
    },

    get(slug: string): Knowledge | null {
      const row = rowBySlug(slug);
      return row ? knowledgeToCamel(row) : null;
    },

    create(input: CreateKnowledgeInput): Knowledge {
      if (!input.slug?.trim() || !input.title?.trim()) {
        throw new Error('slug and title are required');
      }
      if (rowBySlug(input.slug)) throw slugConflict(input.slug);
      const r = db.prepare(`
        INSERT INTO knowledge (slug, title, collection, tags, content, content_type, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.slug,
        input.title,
        input.collection || 'general',
        JSON.stringify(input.tags || []),
        input.content || '',
        input.contentType || 'markdown',
        input.source ?? null,
      );
      return knowledgeToCamel(
        db.prepare('SELECT * FROM knowledge WHERE id = ?').get(r.lastInsertRowid) as Row
      );
    },

    update(slug: string, patch: UpdateKnowledgeInput): Knowledge | null {
      const existing = rowBySlug(slug);
      if (!existing) return null;
      if (patch.slug && patch.slug !== slug && rowBySlug(patch.slug)) {
        throw slugConflict(patch.slug);
      }
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [camel, snake] of Object.entries(KNOWLEDGE_FIELDS)) {
        if (camel in patch) {
          sets.push(`${snake} = ?`);
          const v = (patch as Record<string, unknown>)[camel];
          values.push(camel === 'tags' ? JSON.stringify(Array.isArray(v) ? v : []) : v);
        }
      }
      if (!sets.length) return knowledgeToCamel(existing);

      // Snapshot the current state into knowledge_revisions BEFORE the update,
      // so we never lose the prior content to a careless PATCH. Skip when the
      // patch is a no-op on every snapshotted field — avoids revision spam on
      // re-saves that don't actually change anything.
      const patchChangesState =
        (patch.slug        !== undefined && patch.slug        !== existing.slug) ||
        (patch.title       !== undefined && patch.title       !== existing.title) ||
        (patch.collection  !== undefined && patch.collection  !== existing.collection) ||
        (patch.content     !== undefined && patch.content     !== existing.content) ||
        (patch.contentType !== undefined && patch.contentType !== (existing.content_type ?? 'markdown')) ||
        (patch.tags        !== undefined && JSON.stringify(patch.tags) !== ((existing.tags as string) ?? '[]'));

      if (patchChangesState) {
        db.prepare(`
          INSERT INTO knowledge_revisions (slug, title, collection, tags, content, content_type)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          existing.slug as string,
          existing.title as string,
          existing.collection as string,
          (existing.tags as string) || '[]',
          (existing.content as string) || '',
          (existing.content_type as string) || 'markdown',
        );
      }

      sets.push("updated_at = datetime('now')");
      values.push(slug);
      db.prepare(`UPDATE knowledge SET ${sets.join(', ')} WHERE slug = ?`).run(...values);
      const finalSlug = patch.slug || slug;
      const row = rowBySlug(finalSlug);
      return row ? knowledgeToCamel(row) : null;
    },

    /** Return revisions for a slug, newest first. Capped at `limit` (default 50). */
    listRevisions(slug: string, limit = 50): Array<{
      id: string; slug: string; title: string; collection: string; tags: string[];
      content: string; contentType: string; savedAt: string;
    }> {
      const rows = db.prepare(`
        SELECT * FROM knowledge_revisions
        WHERE slug = ?
        ORDER BY datetime(saved_at) DESC
        LIMIT ?
      `).all(slug, limit) as Row[];
      return rows.map(r => {
        let tags: string[] = [];
        try {
          const parsed = JSON.parse((r.tags as string) || '[]');
          if (Array.isArray(parsed)) tags = parsed.map(String);
        } catch { /* leave empty */ }
        return {
          id: String(r.id),
          slug: r.slug as string,
          title: r.title as string,
          collection: r.collection as string,
          tags,
          content: (r.content as string) || '',
          contentType: (r.content_type as string) || 'markdown',
          savedAt: r.saved_at as string,
        };
      });
    },

    delete(slug: string): { ok: true } {
      db.prepare('DELETE FROM knowledge WHERE slug = ?').run(slug);
      return { ok: true };
    },

    listCollections(): string[] {
      const rows = db.prepare(
        'SELECT DISTINCT collection FROM knowledge ORDER BY collection ASC'
      ).all() as Array<{ collection: string }>;
      return rows.map(r => r.collection);
    },

    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM knowledge').get() as { n: number };
      return row.n;
    },

    /**
     * Render the current knowledge base as a single markdown blob agents can
     * inject into their prompt. Filter by either a collections list or an
     * explicit slugs list; if both are given, an entry qualifies if it matches
     * *either*. Omit both to return the whole KB.
     */
    renderPromptContext(opts: { collections?: string[]; slugs?: string[] } = {}): string {
      const wantCollections = opts.collections?.length ? new Set(opts.collections) : null;
      const wantSlugs       = opts.slugs?.length       ? new Set(opts.slugs)       : null;
      const entries = this.list().filter(e => {
        if (!wantCollections && !wantSlugs) return true;
        if (wantCollections && wantCollections.has(e.collection)) return true;
        if (wantSlugs && wantSlugs.has(e.slug)) return true;
        return false;
      });
      if (!entries.length) return '# Knowledge base\n\n(empty)\n';

      const byCollection = new Map<string, Knowledge[]>();
      for (const e of entries) {
        if (!byCollection.has(e.collection)) byCollection.set(e.collection, []);
        byCollection.get(e.collection)!.push(e);
      }

      const parts: string[] = ['# Knowledge base', ''];
      for (const [collection, items] of [...byCollection.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        parts.push(`## Collection: ${collection}`, '');
        for (const entry of items) {
          const tagLine = entry.tags.length ? ` _(tags: ${entry.tags.join(', ')})_` : '';
          parts.push(`### ${entry.title} — \`${entry.slug}\`${tagLine}`, '');
          if (entry.contentType === 'json') {
            parts.push('```json', entry.content, '```', '');
          } else {
            parts.push(entry.content.trim(), '');
          }
        }
      }
      return parts.join('\n');
    },
  };
}
