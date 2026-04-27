/**
 * One-shot migration: when the `knowledge` table is empty on boot, import the
 * legacy hardcoded files from `.claude/knowledge/shared/` into the DB. Once
 * imported, rename the directory to `shared.archived/` so stale `@`-imports in
 * old agent/command markdown fail loudly on the next run instead of silently
 * reading stale content.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type { PathConfig } from '../../core/paths.js';
import type { KnowledgeContentType } from '../../core/types.js';

interface SeedEntry {
  file: string;
  slug: string;
  title: string;
  collection: string;
  tags: string[];
  contentType: KnowledgeContentType;
}

const SEED_ENTRIES: SeedEntry[] = [
  { file: 'scout-profile.md',    slug: 'scout-profile',    title: 'Scout — Product Profile',     collection: 'product',   tags: ['scout', 'source-of-truth'], contentType: 'markdown' },
  { file: 'architecture.md',     slug: 'architecture',     title: 'Architecture — Agent Reference', collection: 'docs',    tags: ['runtime'],                  contentType: 'markdown' },
  { file: 'voice-blog.md',       slug: 'voice-blog',       title: 'Voice — Blog',                 collection: 'voice',     tags: ['blog'],                     contentType: 'markdown' },
  { file: 'voice-linkedin.md',   slug: 'voice-linkedin',   title: 'Voice — LinkedIn',             collection: 'voice',     tags: ['linkedin'],                 contentType: 'markdown' },
  { file: 'voice-x.md',          slug: 'voice-x',          title: 'Voice — X (Twitter)',          collection: 'voice',     tags: ['x', '280-char'],            contentType: 'markdown' },
  { file: 'voice-reddit.md',     slug: 'voice-reddit',     title: 'Voice — Reddit',               collection: 'voice',     tags: ['reddit'],                   contentType: 'markdown' },
  { file: 'directory-list.json', slug: 'directory-list',   title: 'Directory submission list',    collection: 'seed-list', tags: ['directories'],              contentType: 'json' },
  { file: 'subreddit-list.json', slug: 'subreddit-list',   title: 'Subreddit list',               collection: 'seed-list', tags: ['reddit', 'cadence'],        contentType: 'json' },
  { file: 'goal-context.md',     slug: 'goal-context',     title: 'Goal context — task payload',  collection: 'docs',      tags: ['planner'],                  contentType: 'markdown' },
];

export function runKnowledgeSeed(db: Database.Database, paths: PathConfig): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM knowledge').get() as { n: number };
  if (row.n > 0) return;

  // Prefer the live directory; fall back to the archived copy that a previous
  // seed run may have renamed. This keeps a fresh DB re-seedable even after the
  // original shared/ dir has been moved aside.
  const sharedDirLive     = path.join(paths.knowledgeDir, 'shared');
  const sharedDirArchived = path.join(paths.knowledgeDir, 'shared.archived');
  const sharedDir = fs.existsSync(sharedDirLive)
    ? sharedDirLive
    : fs.existsSync(sharedDirArchived)
      ? sharedDirArchived
      : null;
  if (!sharedDir) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO knowledge (slug, title, collection, tags, content, content_type, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  const tx = db.transaction(() => {
    for (const entry of SEED_ENTRIES) {
      const fullPath = path.join(sharedDir, entry.file);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const r = insert.run(
        entry.slug,
        entry.title,
        entry.collection,
        JSON.stringify(entry.tags),
        content,
        entry.contentType,
        `seed:${entry.file}`,
      );
      if (r.changes > 0) imported += 1;
    }
  });
  tx();

  if (imported === 0) return;

  // Only rename-to-archive when we seeded from the live dir. If we seeded from
  // an already-archived dir (DB reset after a previous seed), leave it alone.
  if (sharedDir === sharedDirLive) {
    try {
      if (!fs.existsSync(sharedDirArchived)) {
        fs.renameSync(sharedDirLive, sharedDirArchived);
      }
    } catch (err) {
      console.warn(`[knowledge-seed] Imported ${imported} entries but failed to archive ${sharedDirLive}: ${(err as Error).message}`);
      return;
    }
    console.log(`[knowledge-seed] Imported ${imported} entries from shared/ and archived the directory.`);
  } else {
    console.log(`[knowledge-seed] Imported ${imported} entries from shared.archived/ (live dir absent — re-seed after DB reset).`);
  }
}
