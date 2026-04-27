import type { RouteDefinition } from '../../core/router.js';
import type { createSkillsRepository } from './skills.model.js';

export function createSkillsController(deps: {
  skills: ReturnType<typeof createSkillsRepository>;
}): RouteDefinition[] {
  const { skills } = deps;
  return [
    { method: 'get', path: '/api/skills', handler: () => ({ status: 200, data: skills.list() }) },
    {
      method: 'get', path: '/api/skills/:slug',
      handler: ({ params }) => {
        const s = skills.get(params.slug);
        return s ? { status: 200, data: s } : { status: 404, data: { error: 'Skill not found' } };
      },
    },
    {
      method: 'delete', path: '/api/skills/:slug',
      handler: ({ params }) => {
        try {
          return { status: 200, data: skills.delete(params.slug) };
        } catch (err) {
          return { status: 400, data: { error: (err as Error).message } };
        }
      },
    },
  ];
}
