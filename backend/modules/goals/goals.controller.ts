import type { RouteDefinition } from '../../core/router.js';
import type { createGoalsRepository } from './goals.model.js';
import type { createGoalRunner } from './goal-runner.js';

export function createGoalsController(deps: {
  goals: ReturnType<typeof createGoalsRepository>;
  goalRunner: ReturnType<typeof createGoalRunner>;
}): RouteDefinition[] {
  const { goals, goalRunner } = deps;

  return [
    { method: 'get', path: '/api/goals', handler: () => ({ status: 200, data: goals.list() }) },
    {
      method: 'get', path: '/api/goals/:id',
      handler: ({ params }) => {
        const goal = goals.getWithJobs(params.id);
        if (!goal) return { status: 404, data: { error: 'Goal not found' } };
        return { status: 200, data: goal };
      },
    },
    {
      method: 'post', path: '/api/goals',
      handler: ({ body }) => ({ status: 201, data: goals.create(body as any) }),
    },
    {
      method: 'patch', path: '/api/goals/:id',
      handler: ({ params, body }) => {
        const goal = goals.update(params.id, body as any);
        return goal ? { status: 200, data: goal } : { status: 400, data: { error: 'No valid fields' } };
      },
    },
    {
      method: 'delete', path: '/api/goals/:id',
      handler: ({ params }) => ({ status: 200, data: goals.delete(params.id) }),
    },
    {
      method: 'post', path: '/api/goals/:id/start',
      handler: ({ params }) => {
        const goal = goals.get(params.id);
        if (!goal) return { status: 404, data: { error: 'Goal not found' } };
        try {
          goalRunner.start(params.id);
          return { status: 200, data: goals.getWithJobs(params.id) };
        } catch (e) {
          return { status: 400, data: { error: (e as Error).message } };
        }
      },
    },
    {
      method: 'post', path: '/api/goals/:id/stop',
      handler: ({ params }) => {
        try {
          goalRunner.stopGoal(params.id);
          return { status: 200, data: goals.getWithJobs(params.id) };
        } catch (e) {
          return { status: 400, data: { error: (e as Error).message } };
        }
      },
    },
    {
      method: 'post', path: '/api/jobs/:id/cancel',
      handler: ({ params }) => {
        try {
          goalRunner.cancelJob(params.id);
          return { status: 200, data: { ok: true, message: 'Job cancelled' } };
        } catch (e) {
          return { status: 400, data: { error: (e as Error).message } };
        }
      },
    },
  ];
}
