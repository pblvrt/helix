import type Database from 'better-sqlite3';
import { taskToCamel, TASK_FIELDS } from '../../core/transforms.js';
import type {
  Task, TaskStatus, TaskType, TaskSource, TaskArtifact,
  VerificationSpec, OnDoneTaskSpec, ReviewHistoryEntry,
} from '../../core/types.js';
import { runVerification, type VerificationResult } from './verification.js';

/**
 * Resolve a `scheduledFor` value into an ISO-8601 absolute timestamp.
 *
 * Accepts:
 *   - null / undefined / empty string → null (no scheduling)
 *   - an ISO string (`2026-04-29T08:00:00Z`, `2026-04-29 08:00:00`) → passed through as ISO
 *   - a relative offset: `+<N><unit>` where unit is `s|m|h|d|w`
 *       e.g. `+7d` = 7 days from now, `+2h` = 2 hours from now
 *
 * Relative offsets are resolved RIGHT NOW — the caller (create, chain
 * spawn) is responsible for calling this at the moment the row is inserted
 * so "+7d" means "7 days from when the row landed in the DB."
 */
export function resolveScheduledFor(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  const relMatch = trimmed.match(/^\+(\d+)(s|m|h|d|w)$/i);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit]! * n;
    return new Date(Date.now() + ms).toISOString();
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    // Garbage input → treat as "no schedule" rather than crash the row insert.
    return null;
  }
  return parsed.toISOString();
}

export interface TransitionResult {
  ok: boolean;
  reason: string;
  task: Task | null;
  spawned: Task[];
  verification: VerificationResult | null;
}

export interface CreateTaskInput {
  type: TaskType;
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  reason?: string;
  source?: TaskSource;
  definitionOfDone?: string;
  verification?: VerificationSpec | null;
  onDone?: OnDoneTaskSpec[];
  /** ISO timestamp or relative (`+7d`, `+2h`). Resolved at insert time. */
  scheduledFor?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  payload?: Record<string, unknown>;
  status?: TaskStatus;
  priority?: number;
  reason?: string;
  runId?: string | null;
  artifacts?: TaskArtifact[];
  summary?: string;
  definitionOfDone?: string;
  verification?: VerificationSpec | null;
  onDone?: OnDoneTaskSpec[];
  reviewFeedback?: string | null;
  reviewHistory?: ReviewHistoryEntry[];
  scheduledFor?: string | null;
  completedAt?: string | null;
}

export interface ListTasksOptions {
  status?: TaskStatus | 'all';
  type?: TaskType;
  source?: TaskSource;
  limit?: number;
  /**
   * When true, excludes backlog tasks whose `scheduled_for` is in the future.
   * The executor uses this; the Board does not (so Pablo can see scheduled
   * work with its wait-time badge).
   */
  eligibleOnly?: boolean;
}

export function createTasksRepository(db: Database.Database) {
  const SELECT_ALL = `SELECT * FROM tasks`;

  return {
    list(opts: ListTasksOptions = {}): Task[] {
      const where: string[] = [];
      const params: unknown[] = [];
      if (opts.status && opts.status !== 'all') { where.push('status = ?'); params.push(opts.status); }
      if (opts.type)   { where.push('type = ?');   params.push(opts.type); }
      if (opts.source) { where.push('source = ?'); params.push(opts.source); }
      if (opts.eligibleOnly) {
        // Only affects backlog rows (scheduled tasks in other statuses are
        // already not in play). A null scheduled_for is always eligible.
        where.push(`(status != 'backlog' OR scheduled_for IS NULL OR scheduled_for <= datetime('now'))`);
      }
      const sql = `${SELECT_ALL}${where.length ? ' WHERE ' + where.join(' AND ') : ''}
                   ORDER BY
                     CASE status
                       WHEN 'in_progress'  THEN 0
                       WHEN 'needs_review' THEN 1
                       WHEN 'backlog'      THEN 2
                       WHEN 'blocked'      THEN 3
                       WHEN 'done'         THEN 4
                     END,
                     -- Within backlog, ready-now tasks sort above future-scheduled.
                     CASE WHEN status = 'backlog' AND scheduled_for IS NOT NULL AND scheduled_for > datetime('now') THEN 1 ELSE 0 END,
                     -- Future-scheduled: earlier wake-up first. Ready tasks: priority then recency.
                     CASE WHEN status = 'backlog' AND scheduled_for IS NOT NULL AND scheduled_for > datetime('now') THEN scheduled_for END ASC,
                     priority ASC,
                     datetime(created_at) DESC
                   ${opts.limit ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : ''}`;
      return db.prepare(sql).all(...params).map(r => taskToCamel(r as Record<string, unknown>));
    },

    get(id: string): Task | null {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      return row ? taskToCamel(row as Record<string, unknown>) : null;
    },

    create(input: CreateTaskInput): Task {
      const r = db.prepare(`
        INSERT INTO tasks (
          type, title, description, payload, priority, reason, source,
          definition_of_done, verification, on_done, scheduled_for
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.type,
        input.title,
        input.description || '',
        JSON.stringify(input.payload || {}),
        input.priority ?? 3,
        input.reason || '',
        input.source || 'manual',
        input.definitionOfDone || '',
        input.verification ? JSON.stringify(input.verification) : null,
        JSON.stringify(input.onDone || []),
        resolveScheduledFor(input.scheduledFor),
      );
      return taskToCamel(db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid) as Record<string, unknown>);
    },

    /** Bulk create — used by the planner. Returns the inserted tasks. */
    createMany(inputs: CreateTaskInput[]): Task[] {
      if (!inputs.length) return [];
      const stmt = db.prepare(`
        INSERT INTO tasks (
          type, title, description, payload, priority, reason, source,
          definition_of_done, verification, on_done, scheduled_for
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction((rows: CreateTaskInput[]) => {
        const ids: number[] = [];
        for (const t of rows) {
          const r = stmt.run(
            t.type,
            t.title,
            t.description || '',
            JSON.stringify(t.payload || {}),
            t.priority ?? 3,
            t.reason || '',
            t.source || 'planner',
            t.definitionOfDone || '',
            t.verification ? JSON.stringify(t.verification) : null,
            JSON.stringify(t.onDone || []),
            resolveScheduledFor(t.scheduledFor),
          );
          ids.push(Number(r.lastInsertRowid));
        }
        return ids;
      });
      const ids = tx(inputs);
      const placeholders = ids.map(() => '?').join(',');
      return db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders}) ORDER BY id`)
        .all(...ids).map(r => taskToCamel(r as Record<string, unknown>));
    },

    update(id: string, patch: UpdateTaskInput): Task | null {
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const [camel, snake] of Object.entries(TASK_FIELDS)) {
        if (camel in patch) {
          sets.push(`${snake} = ?`);
          const v = (patch as Record<string, unknown>)[camel];
          if (camel === 'payload') {
            values.push(JSON.stringify(v || {}));
          } else if (camel === 'artifacts' || camel === 'onDone' || camel === 'reviewHistory') {
            values.push(JSON.stringify(Array.isArray(v) ? v : []));
          } else if (camel === 'verification') {
            values.push(v == null ? null : JSON.stringify(v));
          } else {
            values.push(v);
          }
        }
      }
      if (!sets.length) return this.get(id);
      sets.push("updated_at = datetime('now')");
      // Auto-set completedAt when transitioning to done. needs_review is NOT
      // terminal — it's the "agent finished, human's turn" parking spot.
      if (patch.status === 'done' && !('completedAt' in patch)) {
        sets.push("completed_at = datetime('now')");
      }
      values.push(id);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return this.get(id);
    },

    delete(id: string): { ok: true } {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      return { ok: true };
    },

    /**
     * Approve a task: mark it done and spawn every entry in `onDone` into the
     * backlog. Chained tasks inherit the parent's `payload.goalContext` unless
     * the spec overrides it. All inserts happen in one transaction so a
     * concurrent reader never sees a half-applied chain.
     *
     * Does NOT run verification — callers that want verification must invoke
     * `runVerification` first and only call this on a passing result (or a
     * manual-approval override).
     */
    approveAndSpawnChain(id: string): { task: Task | null; spawned: Task[] } {
      const parent = this.get(id);
      if (!parent) return { task: null, spawned: [] };

      const parentGoalContext = (parent.payload?.goalContext as Record<string, unknown> | undefined) || null;
      const spawnedIds: number[] = [];

      const insertChain = db.prepare(`
        INSERT INTO tasks (
          type, title, description, payload, priority, reason, source,
          definition_of_done, verification, on_done, scheduled_for
        )
        VALUES (?, ?, ?, ?, ?, ?, 'chain', ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        db.prepare(`
          UPDATE tasks
          SET status = 'done',
              review_feedback = NULL,
              completed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(id);

        for (const spec of parent.onDone || []) {
          const payload = { ...(spec.payload || {}) } as Record<string, unknown>;
          if (!('goalContext' in payload) && parentGoalContext) {
            payload.goalContext = parentGoalContext;
          }
          if (!('chainedFrom' in payload)) {
            payload.chainedFrom = parent.id;
          }
          const r = insertChain.run(
            spec.type,
            spec.title,
            spec.description || '',
            JSON.stringify(payload),
            spec.priority ?? parent.priority,
            spec.reason || `chained from #${parent.id}`,
            spec.definitionOfDone || '',
            spec.verification ? JSON.stringify(spec.verification) : null,
            JSON.stringify(spec.onDone || []),
            // Resolve at spawn time so "+7d" means "7 days from when the
            // parent hit done," not "7 days from when the plan was made."
            resolveScheduledFor(spec.scheduledFor),
          );
          spawnedIds.push(Number(r.lastInsertRowid));
        }
      });
      tx();

      const task = this.get(id);
      const spawned = spawnedIds.length
        ? db.prepare(`SELECT * FROM tasks WHERE id IN (${spawnedIds.map(() => '?').join(',')}) ORDER BY id`)
            .all(...spawnedIds).map(r => taskToCamel(r as Record<string, unknown>))
        : [];
      return { task, spawned };
    },

    /**
     * Attempt to transition a task to `done`. Runs verification; if the spec
     * is `manual` or absent, requires `approve: true` (a human click). If the
     * spec is machine-checkable and passes, the transition happens without a
     * human. If it fails, `approve: true` still forces the transition (override).
     *
     * On success, spawns every onDone child and returns them in `spawned`.
     */
    async transitionToDone(
      id: string,
      opts: { approve?: boolean; patch?: UpdateTaskInput } = {},
    ): Promise<TransitionResult> {
      const existing = this.get(id);
      if (!existing) return { ok: false, reason: 'not found', task: null, spawned: [], verification: null };
      if (existing.status === 'done') {
        return { ok: true, reason: 'already done', task: existing, spawned: [], verification: null };
      }

      const hasMachineCheck = existing.verification && existing.verification.kind !== 'manual';
      const approvedByHuman = opts.approve === true;

      if (!approvedByHuman && !hasMachineCheck) {
        return {
          ok: false,
          reason: 'done requires human approval or a non-manual verification',
          task: existing,
          spawned: [],
          verification: null,
        };
      }

      let verification: VerificationResult | null = null;
      if (hasMachineCheck) {
        verification = await runVerification(existing.verification);
        if (!verification.ok && !approvedByHuman) {
          return { ok: false, reason: verification.reason, task: existing, spawned: [], verification };
        }
      }

      if (opts.patch && Object.keys(opts.patch).length) {
        // Apply any collateral fields (summary, artifacts, etc.) before the transition.
        const { status: _discard, ...rest } = opts.patch;
        void _discard;
        if (Object.keys(rest).length) this.update(id, rest);
      }

      const { task, spawned } = this.approveAndSpawnChain(id);
      return { ok: true, reason: verification?.reason || 'approved', task, spawned, verification };
    },

    /**
     * Decline a task in needs_review: append the feedback to reviewHistory,
     * set reviewFeedback, clear runId/summary/artifacts, and move it back to
     * backlog so an agent can retake it with the new feedback in context.
     */
    decline(id: string, feedback: string): Task | null {
      const current = this.get(id);
      if (!current) return null;
      if (current.status !== 'needs_review') {
        // Only needs_review cards can be declined. Anything else is a no-op.
        return current;
      }
      const entry: ReviewHistoryEntry = {
        at: new Date().toISOString(),
        feedback,
        artifactsAtDecline: current.artifacts,
        summaryAtDecline: current.summary,
      };
      const history = [...current.reviewHistory, entry];
      db.prepare(`
        UPDATE tasks
        SET status = 'backlog',
            review_feedback = ?,
            review_history = ?,
            run_id = NULL,
            summary = '',
            artifacts = '[]',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(feedback, JSON.stringify(history), id);
      return this.get(id);
    },

    counts(): Record<TaskStatus, number> {
      const rows = db.prepare(`SELECT status, COUNT(*) as n FROM tasks GROUP BY status`).all() as Array<{ status: string; n: number }>;
      const result: Record<TaskStatus, number> = {
        backlog: 0, in_progress: 0, needs_review: 0, done: 0, blocked: 0,
      };
      for (const r of rows) {
        if (r.status in result) result[r.status as TaskStatus] = r.n;
      }
      return result;
    },
  };
}
