import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type { RouteDefinition, StreamRouteDefinition } from '../../core/router.js';
import type { PathConfig } from '../../core/paths.js';
import type { LogEntry } from '../../core/types.js';
import { actionToCamel } from '../../core/transforms.js';
import type { createActionsRepository } from './actions.model.js';
import type { createJobManager } from './job-manager.js';

type Row = Record<string, unknown>;

function getLog(runsDir: string, actionId: string): LogEntry[] {
  const logPath = path.join(runsDir, `${actionId}.jsonl`);
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.map(line => {
    try { return JSON.parse(line); }
    catch { return { type: 'text', data: { content: line }, timestamp: 0 }; }
  });
}

function getLogPath(runsDir: string, actionId: string): string {
  return path.join(runsDir, `${actionId}.jsonl`);
}

export function createActionsController(deps: {
  actionsRepo: ReturnType<typeof createActionsRepository>;
  jobManager: ReturnType<typeof createJobManager>;
  db: Database.Database;
  paths: PathConfig;
}): RouteDefinition[] {
  const { actionsRepo, jobManager, db, paths } = deps;

  return [
    { method: 'get', path: '/api/actions/commands', handler: () => ({ status: 200, data: actionsRepo.getCommands() }) },
    { method: 'get', path: '/api/actions/status', handler: () => ({ status: 200, data: actionsRepo.getStatus() }) },
    { method: 'post', path: '/api/actions/stop', handler: () => ({ status: 200, data: jobManager.stopActive() }) },
    {
      method: 'post', path: '/api/actions',
      handler: async ({ body }) => {
        const { command, args } = body as { command: string; args?: string };

        // Prevent duplicate submissions
        const existing = db.prepare(
          "SELECT id, status FROM actions WHERE action_type = ? AND status IN ('running', 'queued') LIMIT 1"
        ).get(command) as { id: number; status: string } | undefined;
        if (existing) {
          return { status: 409, data: { error: `${command} is already ${existing.status}`, actionId: String(existing.id) } };
        }

        try {
          const actionId = jobManager.submit(command, args ? { args } : undefined);
          return { status: 201, data: { actionId } };
        } catch (e) {
          return { status: 400, data: { error: (e as Error).message } };
        }
      },
    },
    {
      method: 'post', path: '/api/actions/:id/stop',
      handler: ({ params }) => ({ status: 200, data: jobManager.stop(params.id) }),
    },
    { method: 'get', path: '/api/actions/queue', handler: () => ({ status: 200, data: jobManager.getQueue() }) },

    {
      method: 'get', path: '/api/actions/history',
      handler: ({ query }) => {
        const limit = query.limit ? Number(query.limit) : 20;
        const rows = db.prepare(
          'SELECT * FROM actions WHERE started_at IS NOT NULL ORDER BY started_at DESC LIMIT ?'
        ).all(limit) as Row[];
        return { status: 200, data: rows.map(r => actionToCamel(r)) };
      },
    },
    {
      method: 'get', path: '/api/actions/active',
      handler: () => {
        const row = db.prepare("SELECT * FROM actions WHERE status = 'running' LIMIT 1").get() as Row | undefined;
        return { status: 200, data: row ? actionToCamel(row) : null };
      },
    },
    {
      method: 'get', path: '/api/actions/:id',
      handler: ({ params }) => {
        const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(params.id) as Row | undefined;
        return row ? { status: 200, data: actionToCamel(row) } : { status: 404, data: { error: 'Action not found' } };
      },
    },
    {
      method: 'get', path: '/api/actions/:id/log',
      handler: ({ params }) => {
        const entries = getLog(paths.runsDir, params.id);
        if (entries.length === 0) {
          const row = db.prepare('SELECT id FROM actions WHERE id = ?').get(params.id);
          if (!row) return { status: 404, data: { error: 'Action not found' } };
        }
        return { status: 200, data: entries };
      },
    },
  ];
}

/** SSE stream that tails the log file for an active action. */
export function createActionStreamRoute(deps: {
  db: Database.Database;
  paths: PathConfig;
}): StreamRouteDefinition {
  const { db, paths } = deps;

  return {
    path: '/api/actions/:id/stream',
    handler: ({ params }, stream) => {
      const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(params.id) as Row | undefined;
      if (!row) {
        stream.writeEvent('error', { error: 'Action not found' });
        stream.end();
        return;
      }

      const logPath = getLogPath(paths.runsDir, params.id);

      if (fs.existsSync(logPath)) {
        const existing = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
        for (const line of existing) {
          try {
            const entry = JSON.parse(line);
            stream.writeEvent(entry.type, entry.data);
          } catch {}
        }
      }

      if (row.status !== 'running') {
        stream.writeEvent('status', { status: row.status, exitCode: row.exit_code });
        stream.end();
        return;
      }

      let lastSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      const watcher = setInterval(() => {
        if (!fs.existsSync(logPath)) return;
        const currentSize = fs.statSync(logPath).size;
        if (currentSize > lastSize) {
          const fd = fs.openSync(logPath, 'r');
          const buf = Buffer.alloc(currentSize - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          fs.closeSync(fd);
          lastSize = currentSize;

          for (const line of buf.toString().trim().split('\n').filter(Boolean)) {
            try {
              const entry = JSON.parse(line);
              stream.writeEvent(entry.type, entry.data);
            } catch {}
          }
        }

        const current = db.prepare('SELECT status, exit_code FROM actions WHERE id = ?').get(params.id) as Row | undefined;
        if (current && current.status !== 'running') {
          stream.writeEvent('status', { status: current.status, exitCode: current.exit_code });
          clearInterval(watcher);
          stream.end();
        }
      }, 1000);

      stream.onClose(() => clearInterval(watcher));
    },
  };
}
