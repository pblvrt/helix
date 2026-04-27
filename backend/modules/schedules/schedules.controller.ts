import cron from 'node-cron';
import type { RouteDefinition } from '../../core/router.js';
import type { createSchedulesRepository } from './schedules.model.js';
import type { createActionsRepository } from '../actions/actions.model.js';
import type { createScheduler } from './scheduler.js';

export function createSchedulesController(deps: {
  schedulesRepo: ReturnType<typeof createSchedulesRepository>;
  actionsRepo: ReturnType<typeof createActionsRepository>;
  scheduler: ReturnType<typeof createScheduler>;
}): RouteDefinition[] {
  const { schedulesRepo, actionsRepo, scheduler } = deps;

  return [
    { method: 'get', path: '/api/schedules', handler: () => ({ status: 200, data: schedulesRepo.list() }) },
    {
      method: 'post', path: '/api/schedules',
      handler: ({ body }) => {
        const { command, cronExpression, description, enabled } = body as any;
        if (!command || !cronExpression) return { status: 400, data: { error: 'command and cronExpression required' } };
        if (!cron.validate(cronExpression)) return { status: 400, data: { error: 'Invalid cron expression' } };

        const commandMap = actionsRepo.getCommandMap();
        if (!commandMap[command]) {
          return { status: 400, data: { error: `Unknown command: ${command}` } };
        }

        const schedule = schedulesRepo.create({ command, cronExpression, description, enabled });
        if (schedule.enabled) scheduler.startJob(schedule);
        return { status: 201, data: schedule };
      },
    },
    {
      method: 'patch', path: '/api/schedules/:id',
      handler: ({ params, body }) => {
        const updated = schedulesRepo.update(params.id, body as any);
        if (!updated) return { status: 404, data: { error: 'Not found' } };

        if ((body as any).cronExpression || (body as any).enabled !== undefined) {
          scheduler.stopJob(params.id);
          if (updated.enabled) scheduler.startJob(updated);
        }

        return { status: 200, data: updated };
      },
    },
    {
      method: 'delete', path: '/api/schedules/:id',
      handler: ({ params }) => {
        const result = schedulesRepo.delete(params.id);
        if (!result) return { status: 404, data: { error: 'Not found' } };
        scheduler.stopJob(params.id);
        return { status: 200, data: result };
      },
    },
  ];
}
