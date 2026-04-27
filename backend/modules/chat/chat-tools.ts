/**
 * Chat tool registry.
 *
 * The chat agent (a `claude` CLI subprocess, see chat.service.ts) emits a
 * `===PROPOSE_ACTION===` block naming one of these tools. The service looks
 * up the tool here, runs its handler if auto, or pauses for user confirm
 * if `requiresConfirm`. The JSON schemas double as documentation the agent
 * reads in its system prompt.
 */

import type { createTasksRepository } from '../tasks/tasks.model.js';
import type { createGoalsRepository } from '../goals/goals.model.js';
import type { createKnowledgeRepository } from '../knowledge/knowledge.model.js';
import type { createJobManager } from '../actions/job-manager.js';

export interface ChatToolDeps {
  goalId: string;
  tasksRepo: ReturnType<typeof createTasksRepository>;
  goalsRepo: ReturnType<typeof createGoalsRepository>;
  knowledgeRepo: ReturnType<typeof createKnowledgeRepository>;
  jobManager: ReturnType<typeof createJobManager>;
}

export interface ChatTool {
  name: string;
  description: string;
  requiresConfirm: boolean;
  schema: Record<string, unknown>;
  handle: (deps: ChatToolDeps, input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Helper: build a JSON-schema-ish input_schema for Anthropic. Using plain
 * object literals keeps this dependency-free.
 */
function obj(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

export const CHAT_TOOLS: ChatTool[] = [
  // -------------------- Read-only (auto) --------------------
  {
    name: 'list_tasks',
    description: 'List tasks on this goal\'s board. Use to answer "what\'s in backlog?", "what needs review?", etc. Returns a compact row per task.',
    requiresConfirm: false,
    schema: obj({
      status: { type: 'string', enum: ['backlog', 'in_progress', 'needs_review', 'blocked', 'done', 'all'], description: 'Filter by status. "all" returns every status.' },
      type: { type: 'string', description: 'Filter by task type (free-form string label).' },
      limit: { type: 'number', description: 'Max rows (default 50).' },
    }),
    async handle({ tasksRepo, goalId }, input) {
      const all = tasksRepo.list({
        status: (input.status as string | undefined) === 'all' ? 'all' : (input.status as never) ?? 'all',
        type: input.type as never,
        limit: (input.limit as number | undefined) ?? 50,
      });
      const mine = all.filter(t => (t.payload?.goalContext as Record<string, unknown> | undefined)?.goalId === goalId);
      return mine.map(t => ({
        id: t.id,
        type: t.type,
        title: t.title,
        status: t.status,
        priority: t.priority,
        summary: t.summary,
        reviewFeedback: t.reviewFeedback,
        reason: t.reason,
      }));
    },
  },
  {
    name: 'get_task',
    description: 'Fetch the full row for one task — payload, definitionOfDone, verification, review history, artifacts. Use before updating or declining.',
    requiresConfirm: false,
    schema: obj({ id: { type: 'string', description: 'Task id.' } }, ['id']),
    async handle({ tasksRepo }, input) {
      const t = tasksRepo.get(input.id as string);
      if (!t) return { error: 'Task not found' };
      return t;
    },
  },
  {
    name: 'get_goal',
    description: 'Fetch the current goal — title, status, counts, agent type, context markdown, linked MCPs.',
    requiresConfirm: false,
    schema: obj({}),
    async handle({ goalsRepo, goalId }) {
      return goalsRepo.get(goalId) ?? { error: 'Goal not found' };
    },
  },
  {
    name: 'read_knowledge',
    description: 'Read a knowledge entry by slug. Returns the markdown. Use to check voice guides, product facts, seeded lists before drafting tasks.',
    requiresConfirm: false,
    schema: obj({ slug: { type: 'string' } }, ['slug']),
    async handle({ knowledgeRepo }, input) {
      const k = knowledgeRepo.get(input.slug as string);
      if (!k) return { error: 'Not found' };
      return { slug: k.slug, title: k.title, collection: k.collection, content: k.content };
    },
  },

  // -------------------- Non-destructive creation (auto) --------------------
  {
    name: 'create_task',
    description: 'Create a new task on this goal\'s board. The task spec must include definitionOfDone; verification defaults to manual. Write the recipe into `description` — that is the prompt body the agent will see. Auto-embeds goalContext. Use `scheduledFor` for tasks that should wait (reminders, delayed follow-ups).',
    requiresConfirm: false,
    schema: obj({
      type: { type: 'string', description: 'Free-form label (e.g. "draft-blog", "audit-landing-page").' },
      title: { type: 'string' },
      description: { type: 'string', description: 'The recipe the agent follows. Treat it like briefing a colleague.' },
      priority: { type: 'number', description: '1 (urgent) → 5 (low). Default 3.' },
      reason: { type: 'string', description: 'Why this task exists, one sentence.' },
      payload: { type: 'object', description: 'Task-specific params (slug, directory, etc.). Do not include goalContext — it\'s auto-attached.' },
      definitionOfDone: { type: 'string', description: 'Concrete, observable.' },
      verification: { type: 'object', description: '{ kind: "file_exists"|"file_contains"|"url_ok"|"shell"|"manual", ... }' },
      onDone: { type: 'array', description: 'Follow-up tasks spawned on done. Each has the same shape (including its own scheduledFor if the next step should wait).' },
      scheduledFor: { type: 'string', description: 'When the executor becomes eligible to pick this up. Accepts an ISO-8601 timestamp (`2026-05-01T08:00:00Z`) or a relative offset (`+7d`, `+2h`, `+30m`). Omit for "run asap."' },
    }, ['type', 'title', 'description', 'definitionOfDone']),
    async handle({ tasksRepo, goalsRepo, goalId }, input) {
      const goal = goalsRepo.get(goalId);
      if (!goal) return { error: 'Goal not found' };
      const goalContext = {
        goalId, goalTitle: goal.title, agentType: goal.agentType,
        targetCount: goal.targetCount, currentCount: goal.currentCount,
        context: typeof goal.context === 'object' ? JSON.stringify(goal.context) : String(goal.context ?? ''),
        createdAt: goal.createdAt,
      };
      const payload = { ...(input.payload as Record<string, unknown> ?? {}), goalContext };
      const t = tasksRepo.create({
        type: input.type as string,
        title: input.title as string,
        description: input.description as string,
        priority: (input.priority as number) ?? 3,
        reason: (input.reason as string) ?? 'created via chat',
        source: 'manual',
        payload,
        definitionOfDone: input.definitionOfDone as string,
        verification: input.verification as never,
        onDone: (input.onDone as never) ?? [],
        scheduledFor: (input.scheduledFor as string | undefined) ?? null,
      });
      return { id: t.id, title: t.title, type: t.type, status: t.status, scheduledFor: t.scheduledFor };
    },
  },

  // -------------------- Destructive (confirm required) --------------------
  {
    name: 'update_task',
    description: 'Patch fields on an existing task. Cannot set status to done directly — use approve_task or decline_task for lifecycle transitions.',
    requiresConfirm: true,
    schema: obj({
      id: { type: 'string' },
      patch: {
        type: 'object',
        description: 'Fields to update: title, description, priority, reason, definitionOfDone, verification, onDone, payload.',
      },
    }, ['id', 'patch']),
    async handle({ tasksRepo }, input) {
      const patch = { ...(input.patch as Record<string, unknown>) };
      // Never let chat update_task bypass the lifecycle gate.
      if (patch.status === 'done') return { error: 'Use approve_task instead of update_task with status=done.' };
      const t = tasksRepo.update(input.id as string, patch as never);
      if (!t) return { error: 'Task not found' };
      return { id: t.id, title: t.title, status: t.status };
    },
  },
  {
    name: 'approve_task',
    description: 'Approve a needs_review task — flips it to done, runs verification, spawns onDone chain. Equivalent to the Approve button on the Board.',
    requiresConfirm: true,
    schema: obj({ id: { type: 'string' } }, ['id']),
    async handle({ tasksRepo }, input) {
      const r = await tasksRepo.transitionToDone(input.id as string, { approve: true });
      if (!r.ok && !r.task) return { error: r.reason };
      return { ok: r.ok, reason: r.reason, taskId: r.task?.id, spawned: r.spawned.map(s => ({ id: s.id, type: s.type, title: s.title })) };
    },
  },
  {
    name: 'decline_task',
    description: 'Decline a needs_review task with feedback. Moves it back to backlog with the feedback attached so the agent sees it on the retry.',
    requiresConfirm: true,
    schema: obj({
      id: { type: 'string' },
      feedback: { type: 'string', description: 'What was wrong + what you want instead. The agent reads this on the next attempt.' },
    }, ['id', 'feedback']),
    async handle({ tasksRepo }, input) {
      const t = tasksRepo.decline(input.id as string, input.feedback as string);
      if (!t) return { error: 'Task not found' };
      return { id: t.id, status: t.status, feedback: t.reviewFeedback };
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task. Use sparingly — history is lost. Preferred alternative for "not doing this" is a decline.',
    requiresConfirm: true,
    schema: obj({ id: { type: 'string' } }, ['id']),
    async handle({ tasksRepo }, input) {
      tasksRepo.delete(input.id as string);
      return { ok: true };
    },
  },
  {
    name: 'update_goal_context',
    description: 'Overwrite this goal\'s free-form context markdown — the block the planner reads as its prime directive. Use when the user clarifies their intent.',
    requiresConfirm: true,
    schema: obj({ markdown: { type: 'string' } }, ['markdown']),
    async handle({ goalsRepo, goalId }, input) {
      const goal = goalsRepo.get(goalId);
      if (!goal) return { error: 'Goal not found' };
      const nextContext = { ...(typeof goal.context === 'object' && goal.context ? goal.context : {}), markdown: input.markdown as string };
      const updated = goalsRepo.update(goalId, { context: nextContext } as never);
      return { ok: true, goalId, contextBytes: (input.markdown as string).length, updatedAt: updated?.updatedAt };
    },
  },
  {
    name: 'run_planner',
    description: 'Trigger a plan action on this goal (same as clicking "Run" in the UI). Queues through the job manager — runs after any in-flight action. Use when you want the planner to refresh the backlog after a conversation.',
    requiresConfirm: true,
    schema: obj({}),
    async handle({ goalsRepo, jobManager, goalId }) {
      const goal = goalsRepo.get(goalId);
      if (!goal) return { error: 'Goal not found' };
      const runId = jobManager.submit('plan', {
        agent: goal.agentType,
        args: `===GOAL_CONTEXT===\n${JSON.stringify({
          goalId, goalTitle: goal.title, agentType: goal.agentType,
          targetCount: goal.targetCount, currentCount: goal.currentCount,
          context: typeof goal.context === 'object' ? JSON.stringify(goal.context) : String(goal.context ?? ''),
          createdAt: goal.createdAt, triggeredBy: 'chat',
        }, null, 2)}\n===END===`,
      });
      return { ok: true, runId, note: 'Plan queued. Watch the Activity tab or Goal page.' };
    },
  },
];

export function findTool(name: string): ChatTool | undefined {
  return CHAT_TOOLS.find(t => t.name === name);
}
