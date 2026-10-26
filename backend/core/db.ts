/**
 * Database initialization — single source of truth for schema.
 *
 * The schema intentionally covers only the generic agent-queue primitives:
 *   - user_config          arbitrary JSON blob for app settings
 *   - goals / jobs / actions   the agent execution pipeline
 *   - mcp_connections       MCP servers available to agents
 *   - goal_mcp_connections  which MCP servers a goal may use
 *
 * Add your own domain tables (leads, contacts, items, …) in a new module
 * under backend/modules/<feature>/ and create them here.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      target_count INTEGER,
      current_count INTEGER NOT NULL DEFAULT 0,
      context TEXT NOT NULL DEFAULT '{}',
      agent_type TEXT NOT NULL DEFAULT 'seo',
      cron_expression TEXT,
      last_run_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);

  // Migrate existing databases: add agent_type column if missing.
  const goalCols = db.prepare("PRAGMA table_info(goals)").all() as Array<{ name: string }>;
  if (!goalCols.some(c => c.name === 'agent_type')) {
    db.exec(`ALTER TABLE goals ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'seo'`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      action_type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      result_summary TEXT NOT NULL DEFAULT '',
      sequence_order INTEGER NOT NULL DEFAULT 0,
      pid INTEGER,
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS goal_mcp_connections (
      goal_id INTEGER NOT NULL,
      mcp_id INTEGER NOT NULL,
      PRIMARY KEY (goal_id, mcp_id),
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
      FOREIGN KEY (mcp_id) REFERENCES mcp_connections(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'backlog',
      priority INTEGER NOT NULL DEFAULT 3,
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      run_id TEXT,
      artifacts TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      definition_of_done TEXT NOT NULL DEFAULT '',
      verification TEXT,
      on_done TEXT NOT NULL DEFAULT '[]',
      review_feedback TEXT,
      review_history TEXT NOT NULL DEFAULT '[]',
      scheduled_for TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority DESC, created_at);`);

  // Additive migration for existing DBs. SQLite ALTER TABLE only supports a
  // subset of operations, but ADD COLUMN works and is idempotent via the
  // PRAGMA check.
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  const taskColNames = new Set(taskCols.map(c => c.name));
  if (!taskColNames.has('artifacts')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN artifacts TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!taskColNames.has('summary')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN summary TEXT NOT NULL DEFAULT ''`);
  }
  if (!taskColNames.has('definition_of_done')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN definition_of_done TEXT NOT NULL DEFAULT ''`);
  }
  if (!taskColNames.has('verification')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN verification TEXT`);
  }
  if (!taskColNames.has('on_done')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN on_done TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!taskColNames.has('review_feedback')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN review_feedback TEXT`);
  }
  if (!taskColNames.has('review_history')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN review_history TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!taskColNames.has('scheduled_for')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN scheduled_for TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_for ON tasks(scheduled_for) WHERE scheduled_for IS NOT NULL;`);

  // Goal operator chat — per-goal conversation history. Separate from the
  // action/log system because chat is streaming and conversational rather
  // than queued. The assistant calls tools (CRUD on tasks, trigger planner,
  // edit goal context) and tool outcomes land in this table as extra rows
  // so the UI can replay the full exchange on page load.
  db.exec(`
    CREATE TABLE IF NOT EXISTS goal_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
      content TEXT NOT NULL DEFAULT '',
      tool_calls TEXT NOT NULL DEFAULT '[]',
      tool_use_id TEXT,
      tool_result TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_goal_messages_goal_created ON goal_messages(goal_id, created_at);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      collection TEXT NOT NULL DEFAULT 'general',
      tags TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'markdown'
        CHECK (content_type IN ('markdown', 'json', 'text')),
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_collection ON knowledge(collection);`);

  // Append-only revision log — snapshots the previous state of an entry on every
  // update, so accidental clobbers are recoverable. No hard FK to knowledge(id):
  // we track slug by value so revisions survive a slug rename or row delete.
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      collection TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'markdown',
      saved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_revisions_slug ON knowledge_revisions(slug, saved_at DESC);`);

  // Generic network-response cache used by the catalog proxies (Smithery,
  // skills.sh). Keyed by URL; TTL per-row. Holds untrusted third-party
  // payloads — callers must parse defensively.
  db.exec(`
    CREATE TABLE IF NOT EXISTS http_cache (
      url        TEXT PRIMARY KEY,
      body       TEXT NOT NULL,
      status     INTEGER NOT NULL DEFAULT 200,
      expires_at TEXT NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_http_cache_expires ON http_cache(expires_at);`);

  // Mark stale running actions as crashed — a previous process died mid-run.
  const crashedActions = db.prepare("UPDATE actions SET status = 'crashed' WHERE status = 'running'").run();
  if (crashedActions.changes > 0) {
    console.log(`[db] Recovered ${crashedActions.changes} running action(s) → crashed (prior process died mid-run).`);
  }
  // Similarly, any task left in_progress from a crashed session should go back
  // to backlog. needs_review tasks must NOT be touched here — they're awaiting
  // human action, not agent action.
  // We log when this fires because a silent revert masks bugs like the agent
  // PATCHing `needs_review` against a dead API and not noticing — boot then
  // wipes the in_progress claim and the user sees "executor did nothing."
  const recoveredTasks = db.prepare("UPDATE tasks SET status = 'backlog', run_id = NULL WHERE status = 'in_progress'").run();
  if (recoveredTasks.changes > 0) {
    console.log(`[db] Reverted ${recoveredTasks.changes} task(s) from in_progress → backlog (recovery from prior crash).`);
  }
  // Retire the old 'skipped' state — the review-decline flow replaces it.
  // Existing skipped rows are left in place but will not be shown in the UI.
  // Convert them to 'done' so counts/filters stay consistent.
  db.prepare("UPDATE tasks SET status = 'done' WHERE status = 'skipped'").run();

  return db;
}
