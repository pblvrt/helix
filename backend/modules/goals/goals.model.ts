import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type { Goal, Job, Action } from '../../core/types.js';
import {
  goalToCamel,
  jobToCamel,
  actionToCamel,
  GOAL_FIELDS,
  JOB_FIELDS,
  ACTION_FIELDS,
} from '../../core/transforms.js';

type Row = Record<string, unknown>;

export function createGoalsRepository(db: Database.Database, runsDir?: string) {
  return {
    // -----------------------------------------------------------------------
    // Goals
    // -----------------------------------------------------------------------

    list(): Goal[] {
      const rows = db.prepare('SELECT * FROM goals ORDER BY id DESC').all();
      return rows.map(r => goalToCamel(r as Row));
    },

    get(id: string): Goal | null {
      const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id);
      return row ? goalToCamel(row as Row) : null;
    },

    /** Get goal with nested jobs and actions */
    getWithJobs(id: string): Goal | null {
      const goal = this.get(id);
      if (!goal) return null;
      goal.jobs = this.getJobs(id);
      return goal;
    },

    create(data: {
      title: string;
      targetCount?: number;
      cronExpression?: string;
      context?: Record<string, unknown>;
      agentType?: string;
    }): Goal {
      const result = db.prepare(`
        INSERT INTO goals (title, target_count, cron_expression, context, agent_type)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        data.title,
        data.targetCount ?? null,
        data.cronExpression ?? null,
        data.context ? JSON.stringify(data.context) : '{}',
        data.agentType || 'seo',
      );
      return goalToCamel(db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid) as Row);
    },

    update(id: string, data: Partial<Goal>): Goal | null {
      const sets: string[] = [];
      const values: unknown[] = [];

      for (const [camel, snake] of Object.entries(GOAL_FIELDS)) {
        if (camel in (data as Record<string, unknown>)) {
          let val = (data as Record<string, unknown>)[camel];
          if (camel === 'context' && typeof val === 'object') val = JSON.stringify(val);
          sets.push(`${snake} = ?`);
          values.push(val);
        }
      }

      if (sets.length === 0) return null;

      sets.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return goalToCamel(db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Row);
    },

    delete(id: string): { ok: true } {
      // Clean up per-action log files before cascade delete
      if (runsDir) {
        const actions = db.prepare(
          'SELECT a.id FROM actions a JOIN jobs j ON j.id = a.job_id WHERE j.goal_id = ?'
        ).all(id) as { id: number }[];
        for (const a of actions) {
          const logPath = path.join(runsDir, `${a.id}.jsonl`);
          try { fs.unlinkSync(logPath); } catch {}
        }
      }
      db.prepare('DELETE FROM goals WHERE id = ?').run(id);
      return { ok: true };
    },

    // -----------------------------------------------------------------------
    // Jobs
    // -----------------------------------------------------------------------

    getJobs(goalId: string): Job[] {
      const jobRows = db.prepare('SELECT * FROM jobs WHERE goal_id = ? ORDER BY id ASC').all(goalId) as Row[];
      return jobRows.map(r => {
        const job = jobToCamel(r);
        job.actions = this.getActions(job.id);
        return job;
      });
    },

    createJob(goalId: string): Job {
      const result = db.prepare('INSERT INTO jobs (goal_id) VALUES (?)').run(goalId);
      return jobToCamel(db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid) as Row);
    },

    updateJob(jobId: string, data: Partial<Job>): Job | null {
      const sets: string[] = [];
      const values: unknown[] = [];

      for (const [camel, snake] of Object.entries(JOB_FIELDS)) {
        if (camel in (data as Record<string, unknown>)) {
          sets.push(`${snake} = ?`);
          values.push((data as Record<string, unknown>)[camel]);
        }
      }

      if (sets.length === 0) return null;

      values.push(jobId);
      db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      return row ? jobToCamel(row as Row) : null;
    },

    cancelJob(jobId: string): void {
      db.prepare(
        "UPDATE actions SET status = 'cancelled', completed_at = datetime('now') WHERE job_id = ? AND status IN ('pending', 'queued')"
      ).run(jobId);
      db.prepare(
        "UPDATE jobs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?"
      ).run(jobId);
    },

    // -----------------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------------

    getActions(jobId: string): Action[] {
      const rows = db.prepare('SELECT * FROM actions WHERE job_id = ? ORDER BY sequence_order ASC').all(jobId) as Row[];
      return rows.map(r => actionToCamel(r));
    },

    createAction(
      jobId: string | null,
      data: { actionType: string; config?: Record<string, unknown>; sequenceOrder?: number },
    ): Action {
      const result = db.prepare(`
        INSERT INTO actions (job_id, action_type, config, sequence_order)
        VALUES (?, ?, ?, ?)
      `).run(
        jobId,
        data.actionType,
        JSON.stringify(data.config || {}),
        data.sequenceOrder ?? 0,
      );
      return actionToCamel(db.prepare('SELECT * FROM actions WHERE id = ?').get(result.lastInsertRowid) as Row);
    },

    updateAction(actionId: string, data: Partial<Action>): Action | null {
      const sets: string[] = [];
      const values: unknown[] = [];

      for (const [camel, snake] of Object.entries(ACTION_FIELDS)) {
        if (camel in (data as Record<string, unknown>)) {
          let val = (data as Record<string, unknown>)[camel];
          if (camel === 'config' && typeof val === 'object') val = JSON.stringify(val);
          sets.push(`${snake} = ?`);
          values.push(val);
        }
      }

      if (sets.length === 0) return null;

      values.push(actionId);
      db.prepare(`UPDATE actions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId);
      return row ? actionToCamel(row as Row) : null;
    },
  };
}
