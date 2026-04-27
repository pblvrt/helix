import type { RouteDefinition } from '../../core/router.js';
import type { createTasksRepository } from './tasks.model.js';
import type { TaskStatus } from '../../core/types.js';

/**
 * Tasks controller — CRUD + lifecycle endpoints. Task **execution** lives in
 * the Executor (Goal → Job → Execute pattern); this controller owns the
 * transitions an agent or a human can trigger from the outside.
 *
 * Lifecycle rules enforced here:
 *   - Agents reach at most `needs_review` or `blocked`. A PATCH with
 *     status=done goes through `transitionToDone`, which requires either
 *     `approve: true` (human click) or a passing non-manual verification.
 *   - On successful transition to `done`, every entry in `onDone` is spawned
 *     into the backlog with `source: 'chain'`, inheriting `payload.goalContext`.
 *   - Decline is its own endpoint — it mutates reviewHistory and resets the
 *     card to backlog with the feedback attached.
 */
export function createTasksController(deps: {
  tasksRepo: ReturnType<typeof createTasksRepository>;
}): RouteDefinition[] {
  const { tasksRepo } = deps;

  return [
    {
      method: 'get',
      path: '/api/tasks',
      handler: ({ query }) => {
        const status = (query.status as TaskStatus | 'all' | undefined);
        const limit = query.limit ? Number(query.limit) : undefined;
        const eligibleOnly = query.eligibleOnly === 'true' || query.eligibleOnly === '1';
        return { status: 200, data: tasksRepo.list({ status, limit, eligibleOnly }) };
      },
    },
    {
      method: 'get',
      path: '/api/tasks/counts',
      handler: () => ({ status: 200, data: tasksRepo.counts() }),
    },
    {
      method: 'get',
      path: '/api/tasks/:id',
      handler: ({ params }) => {
        const t = tasksRepo.get(params.id);
        return t ? { status: 200, data: t } : { status: 404, data: { error: 'Task not found' } };
      },
    },
    {
      method: 'post',
      path: '/api/tasks',
      handler: ({ body }) => {
        const input = body as Record<string, unknown>;

        // Bulk create — planner posts { tasks: [...] }
        if (Array.isArray(input.tasks)) {
          const tasks = tasksRepo.createMany(input.tasks as Parameters<typeof tasksRepo.createMany>[0]);
          return { status: 201, data: tasks };
        }

        if (!input.type || !input.title) {
          return { status: 400, data: { error: 'type and title are required' } };
        }
        const task = tasksRepo.create(input as unknown as Parameters<typeof tasksRepo.create>[0]);
        return { status: 201, data: task };
      },
    },
    {
      method: 'patch',
      path: '/api/tasks/:id',
      handler: async ({ params, body }) => {
        const patch = (body || {}) as Record<string, unknown> & { approve?: boolean };
        const existing = tasksRepo.get(params.id);
        if (!existing) return { status: 404, data: { error: 'Task not found' } };

        // Transition to done goes through the verification path.
        if (patch.status === 'done' && existing.status !== 'done') {
          const { approve, status: _ignored, ...rest } = patch;
          void _ignored;
          const result = await tasksRepo.transitionToDone(params.id, {
            approve: approve === true,
            patch: rest as Parameters<typeof tasksRepo.update>[1],
          });
          if (!result.ok) {
            return {
              status: 422,
              data: { error: result.reason, verification: result.verification },
            };
          }
          return { status: 200, data: { task: result.task, spawned: result.spawned } };
        }

        // Generic update — strip the approve flag; it's a transition hint, not a column.
        const { approve: _approve, ...rest } = patch;
        void _approve;
        const updated = tasksRepo.update(params.id, rest as Parameters<typeof tasksRepo.update>[1]);
        return updated ? { status: 200, data: updated } : { status: 404, data: { error: 'Task not found' } };
      },
    },
    {
      method: 'post',
      path: '/api/tasks/:id/approve',
      handler: async ({ params }) => {
        const result = await tasksRepo.transitionToDone(params.id, { approve: true });
        if (!result.ok && !result.task) return { status: 404, data: { error: result.reason } };
        return { status: 200, data: { task: result.task, spawned: result.spawned } };
      },
    },
    {
      method: 'post',
      path: '/api/tasks/:id/decline',
      handler: ({ params, body }) => {
        const feedback = ((body as Record<string, unknown>)?.feedback as string || '').trim();
        if (!feedback) return { status: 400, data: { error: 'feedback is required' } };
        const updated = tasksRepo.decline(params.id, feedback);
        return updated ? { status: 200, data: updated } : { status: 404, data: { error: 'Task not found' } };
      },
    },
    {
      method: 'delete',
      path: '/api/tasks/:id',
      handler: ({ params }) => ({ status: 200, data: tasksRepo.delete(params.id) }),
    },
  ];
}
