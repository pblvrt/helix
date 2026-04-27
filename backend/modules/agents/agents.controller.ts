import type { RouteDefinition } from '../../core/router.js';
import type { createAgentsRepository } from './agents.model.js';

export function createAgentsController(deps: {
  agentsRepo: ReturnType<typeof createAgentsRepository>;
}): RouteDefinition[] {
  const { agentsRepo } = deps;
  return [
    {
      method: 'get',
      path: '/api/agents',
      handler: () => ({ status: 200, data: agentsRepo.list() }),
    },
    {
      method: 'get',
      path: '/api/agents/:name',
      handler: ({ params }) => {
        const agent = agentsRepo.get(params.name);
        return agent ? { status: 200, data: agent } : { status: 404, data: { error: 'Agent not found' } };
      },
    },
  ];
}
