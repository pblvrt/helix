import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { PathConfig } from '../../core/paths.js';
import type { Command, ActionsStatus } from '../../core/types.js';

/**
 * Parse a command file: `.claude/commands/<name>.md`.
 *
 * Supported frontmatter:
 *   ---
 *   agent: scout                # name of a file in .claude/agents/ (optional)
 *   description: Short summary  # shown in the UI (optional)
 *   ---
 *
 * The body (after the frontmatter) is the prompt.
 */
function parseCommandFile(filePath: string): { agent: string; prompt: string } | null {
  let raw: string;
  try { raw = fs.readFileSync(filePath, 'utf-8'); }
  catch { return null; }

  const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  let agent = '';
  let body = raw;
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    body = raw.slice(frontmatterMatch[0].length);
    for (const line of fm.split('\n')) {
      const m = line.match(/^\s*agent\s*:\s*(.+?)\s*$/);
      if (m) agent = m[1].replace(/^["']|["']$/g, '');
    }
  }
  return { agent, prompt: body.trim() };
}

export function createActionsRepository(db: Database.Database, paths: PathConfig) {
  /**
   * Discover commands by listing `.claude/commands/*.md`.
   * A new command is as simple as dropping a new markdown file.
   */
  function getCommandMap(): Record<string, { agent: string; prompt: string }> {
    const result: Record<string, { agent: string; prompt: string }> = {};
    let files: string[] = [];
    try { files = fs.readdirSync(paths.commandsDir); }
    catch { return result; }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const name = f.replace(/\.md$/, '');
      const parsed = parseCommandFile(path.join(paths.commandsDir, f));
      if (parsed) result[name] = parsed;
    }
    return result;
  }

  return {
    getCommands(): Command[] {
      return Object.entries(getCommandMap()).map(([id, { agent, prompt }]) => ({ id, agent, prompt }));
    },

    getCommandMap(): Record<string, { agent: string; prompt: string }> {
      return getCommandMap();
    },

    getStatus(): ActionsStatus {
      const active = db.prepare(
        "SELECT id, action_type, status, pid, started_at FROM actions WHERE status = 'running' AND pid IS NOT NULL LIMIT 1"
      ).get() as Record<string, unknown> | undefined;
      return {
        running: !!active,
        activeAction: active
          ? {
              id: String(active.id),
              actionType: active.action_type as string,
              status: active.status as string,
              pid: active.pid as number,
              startedAt: active.started_at as string,
            }
          : null,
      };
    },

    stop(): { ok: true; message: string } {
      const active = db.prepare(
        "SELECT id, pid FROM actions WHERE status = 'running' AND pid IS NOT NULL LIMIT 1"
      ).get() as { id: number; pid: number } | undefined;
      if (active && active.pid) {
        try { process.kill(active.pid, 'SIGTERM'); } catch {}
        db.prepare(
          "UPDATE actions SET status = 'stopped', finished_at = datetime('now'), completed_at = datetime('now') WHERE id = ?"
        ).run(active.id);
        return { ok: true, message: 'Action stopped' };
      }
      return { ok: true, message: 'No action running' };
    },

    generateRunId(): string {
      return Math.random().toString(36).slice(2, 10);
    },
  };
}
