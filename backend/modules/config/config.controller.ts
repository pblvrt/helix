import type { RouteDefinition } from '../../core/router.js';
import type { createUserConfigRepository } from './user-config.model.js';

/**
 * User config routes only. The old "editable markdown files" registry was
 * retired in favor of the Knowledge module. If you need a filesystem-backed
 * editor again, bring the file registry back into its own module — do NOT
 * reuse this one as a dumping ground.
 */
export function createConfigController(deps: {
  userConfig: ReturnType<typeof createUserConfigRepository>;
}): RouteDefinition[] {
  const { userConfig } = deps;

  return [
    { method: 'get', path: '/api/user-config', handler: () => ({ status: 200, data: userConfig.get() }) },
    {
      method: 'put', path: '/api/user-config',
      handler: ({ body }) => {
        userConfig.save(body as any);
        return { status: 200, data: { ok: true } };
      },
    },
    { method: 'get', path: '/api/user-config/status', handler: () => ({ status: 200, data: userConfig.status() }) },
  ];
}
