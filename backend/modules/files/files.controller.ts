import type { RouteDefinition } from '../../core/router.js';
import type { createFilesRepository } from './files.model.js';
import { FileAccessError } from './files.model.js';

function toHttpError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof FileAccessError) {
    const status = err.code === 'NOT_FOUND' ? 404
      : err.code === 'OUTSIDE_ALLOWLIST' ? 403
      : err.code === 'TOO_LARGE' ? 413
      : err.code === 'UNSUPPORTED_TYPE' ? 415
      : 400;
    return { status, body: { error: err.message, code: err.code } };
  }
  return { status: 500, body: { error: err instanceof Error ? err.message : 'Internal error' } };
}

export function createFilesController(deps: {
  files: ReturnType<typeof createFilesRepository>;
}): RouteDefinition[] {
  const { files } = deps;

  return [
    {
      method: 'get',
      path: '/api/files',
      handler: ({ query }) => {
        const p = typeof query.path === 'string' ? query.path : '';
        if (!p) return { status: 400, data: { error: 'path query param required' } };
        try {
          return { status: 200, data: files.read(p) };
        } catch (err) {
          const { status, body } = toHttpError(err);
          return { status, data: body };
        }
      },
    },
    {
      method: 'put',
      path: '/api/files',
      handler: ({ body }) => {
        const { path: p, content } = body as { path?: string; content?: string };
        if (!p || typeof content !== 'string') {
          return { status: 400, data: { error: 'path and content are required' } };
        }
        try {
          return { status: 200, data: files.write(p, content) };
        } catch (err) {
          const { status, body: errBody } = toHttpError(err);
          return { status, data: errBody };
        }
      },
    },
  ];
}
