/**
 * Goal Runner — orchestrates a goal by queueing a single `run` action.
 *
 * Pattern: start(goalId) → create Job → single "run" Action → the configured
 * agent plans and spawns subagents internally → complete job/goal.
 *
 * Pure functions (tested) live at the top so goal-runner.test.ts can import
 * them without constructing the full dependency graph.
 */

import type Database from 'better-sqlite3';
import type { PathConfig } from '../../core/paths.js';
import type { createGoalsRepository } from './goals.model.js';
import type { createJobManager } from '../actions/job-manager.js';
import type { createMcpRepository } from '../mcp/mcp.model.js';
import { actionToCamel } from '../../core/transforms.js';
import { writeScopedMcpJson } from '../mcp/mcp-sync.js';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Pure functions (tested)
// ---------------------------------------------------------------------------

/**
 * Build the context string injected into each action prompt. The agent uses
 * this to know the goal, its progress, and the history of prior actions.
 */
export function buildContextInjection(
  db: Database.Database,
  goalId: string,
  currentActionId: string,
): string {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId) as Row | undefined;
  if (!goal) return '';

  const actions = db.prepare(`
    SELECT a.* FROM actions a
    JOIN jobs j ON j.id = a.job_id
    WHERE j.goal_id = ?
    ORDER BY a.sequence_order ASC
  `).all(goalId) as Row[];

  const previousLines: string[] = [];
  let currentConfig = '';
  for (const a of actions) {
    const action = actionToCamel(a);
    if (action.id === currentActionId) {
      currentConfig = JSON.stringify(action.config, null, 2);
      continue;
    }
    if (action.status === 'done' || action.status === 'failed' || action.status === 'error') {
      const summary = action.resultSummary || 'no summary';
      previousLines.push(`- [${action.status.toUpperCase()}] ${action.actionType}: ${summary}`);
    }
  }

  const progressStr = goal.target_count
    ? `${goal.current_count}/${goal.target_count}`
    : `${goal.current_count}`;
  const target = goal.target_count ? String(goal.target_count) : 'open-ended';

  const lines: string[] = [
    '---', 'GOAL CONTEXT',
    `Goal: "${goal.title}"`,
    `Goal ID: ${goalId}`,
    `Progress: ${progressStr}`,
    `Target: ${target}`,
    '',
  ];
  if (currentConfig && currentConfig !== '{}') {
    lines.push('Action config:', currentConfig, '');
  }
  if (previousLines.length > 0) {
    lines.push('Previous actions:', ...previousLines, '');
  }
  lines.push('---');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Goal Runner
// ---------------------------------------------------------------------------

interface GoalRunnerOpts {
  db: Database.Database;
  paths: PathConfig;
  goalsRepo: ReturnType<typeof createGoalsRepository>;
  jobManager: ReturnType<typeof createJobManager>;
  mcpRepo?: ReturnType<typeof createMcpRepository>;
  /** The command (file in .claude/commands/) the runner invokes. Default: 'plan'. */
  defaultCommand?: string;
}

export function createGoalRunner(opts: GoalRunnerOpts) {
  const { db, paths, goalsRepo, jobManager, mcpRepo } = opts;
  const defaultCommand = opts.defaultCommand ?? 'plan';
  let activeJobId: string | null = null;

  jobManager.emitter.on('job:done', (actionId: string, exitCode: number | null) => {
    const actionRow = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as Row | undefined;
    if (!actionRow || !actionRow.job_id) return;

    const jobId = String(actionRow.job_id);
    const jobRow = db.prepare('SELECT goal_id FROM jobs WHERE id = ?').get(actionRow.job_id) as { goal_id: number } | undefined;
    if (!jobRow) return;
    const goalId = String(jobRow.goal_id);

    const status = exitCode === 0 ? 'done' : 'failed';
    goalsRepo.updateAction(actionId, { status, completedAt: new Date().toISOString() } as any);

    if (status === 'done') {
      completeJob(goalId, jobId);
    } else {
      failJob(goalId, jobId);
    }
  });

  function failJob(goalId: string, jobId: string) {
    activeJobId = null;
    goalsRepo.updateJob(jobId, { status: 'failed', completedAt: new Date().toISOString() } as any);
    goalsRepo.update(goalId, { status: 'failed' } as any);
  }

  function completeJob(goalId: string, jobId: string) {
    activeJobId = null;
    goalsRepo.updateJob(jobId, { status: 'completed', completedAt: new Date().toISOString() } as any);
    goalsRepo.update(goalId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    } as any);
  }

  /**
   * Start a goal — create a Job, submit a single Action of the configured
   * command (default: 'plan'), with the goal's agent type applied as an
   * override (--agent <goal.agentType>) and a structured GOAL CONTEXT block
   * injected as args. The agent (planner) reads the block to drive task
   * creation. Tasks it creates should embed this same goalContext into their
   * payloads so downstream subagents inherit it.
   */
  function start(goalId: string): void {
    const goal = goalsRepo.get(goalId);
    if (!goal) throw new Error('Goal not found');
    if (goal.status === 'active') throw new Error('Goal is already running');

    const job = goalsRepo.createJob(goalId);
    activeJobId = job.id;

    goalsRepo.updateJob(job.id, { status: 'active' } as any);
    goalsRepo.update(goalId, { status: 'active' } as any);

    // Resolve per-goal MCP connections (if mcpRepo is wired up).
    const mcpSummaries: Array<{ name: string; url: string }> = [];
    let enabledMcpIds: string[] = [];
    if (mcpRepo) {
      enabledMcpIds = mcpRepo.listForGoal(goalId);
      const enabledSet = new Set(enabledMcpIds);
      if (enabledSet.size) {
        for (const m of mcpRepo.list()) {
          if (enabledSet.has(m.id)) mcpSummaries.push({ name: m.name, url: m.url });
        }
      }
    }
    const contextMarkdown = typeof goal.context?.markdown === 'string'
      ? (goal.context.markdown as string)
      : JSON.stringify(goal.context || {}, null, 2);

    // Full, self-describing context block. Planner will echo the object under
    // `goalContext` into each task's payload so execution-time agents inherit it.
    const goalContext = {
      goalId,
      goalTitle: goal.title,
      agentType: goal.agentType,
      targetCount: goal.targetCount,
      currentCount: goal.currentCount,
      mcpConnections: mcpSummaries,
      context: contextMarkdown,
      createdAt: goal.createdAt,
    };

    const priorContext = buildContextInjection(db, goalId, '');
    const contextBlock = [
      '===GOAL_CONTEXT===',
      JSON.stringify(goalContext, null, 2),
      '===END===',
      '',
      priorContext,
    ].join('\n');

    const action = goalsRepo.createAction(job.id, {
      actionType: defaultCommand,
      config: { goal: goal.title, agentType: goal.agentType },
      sequenceOrder: 0,
    });

    // Write a scoped `.mcp.json` for this action. The Claude process invoked
    // by the job manager will be pointed at it via `--mcp-config`, so the
    // agent can ONLY see MCP servers the goal explicitly linked. If the goal
    // linked nothing, we write no file and the process falls back to the
    // global `.mcp.json` (the less-strict default — consider tightening
    // later so unlinked goals get zero MCPs).
    let mcpConfigPath: string | undefined;
    if (mcpRepo && enabledMcpIds.length) {
      const scoped = `${paths.runsDir}/${action.id}.mcp.json`;
      const written = writeScopedMcpJson(scoped, mcpRepo, enabledMcpIds);
      if (written) mcpConfigPath = written;
    }

    jobManager.enqueue(action.id, {
      args: contextBlock,
      agent: goal.agentType,
      mcpConfigPath,
    });
  }

  function cancelJob(jobId: string): void {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Row | undefined;
    if (!job) throw new Error('Job not found');

    const activeActions = db.prepare(
      "SELECT id FROM actions WHERE job_id = ? AND status IN ('running', 'queued')"
    ).all(jobId) as { id: number }[];
    for (const a of activeActions) {
      jobManager.stop(String(a.id));
    }

    goalsRepo.cancelJob(jobId);

    if (activeJobId === jobId) activeJobId = null;

    const goalId = String(job.goal_id);
    goalsRepo.update(goalId, { status: 'paused' } as any);
  }

  function stopGoal(goalId: string): void {
    const activeJobs = db.prepare(
      "SELECT id FROM jobs WHERE goal_id = ? AND status IN ('active', 'pending')"
    ).all(goalId) as { id: number }[];
    for (const j of activeJobs) {
      try { cancelJob(String(j.id)); } catch {}
    }
    activeJobId = null;
    goalsRepo.update(goalId, { status: 'paused' } as any);
  }

  /** On startup, mark zombie runs and pending items as crashed/cancelled. */
  function recover() {
    db.prepare(`
      UPDATE actions SET status = 'crashed', completed_at = datetime('now')
      WHERE status = 'running' AND pid IS NOT NULL
    `).run();

    db.prepare(`
      UPDATE actions SET status = 'cancelled', completed_at = datetime('now')
      WHERE status = 'queued' AND job_id IS NOT NULL
    `).run();

    db.prepare(`
      UPDATE jobs SET status = 'failed', completed_at = datetime('now')
      WHERE status IN ('planning', 'active')
    `).run();

    db.prepare(`
      UPDATE goals SET status = 'paused', updated_at = datetime('now')
      WHERE status IN ('planning', 'active')
    `).run();

    jobManager.processQueue();
  }

  return { start, cancelJob, stopGoal, recover };
}
