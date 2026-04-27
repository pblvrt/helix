import type { RouteDefinition } from '../../core/router.js';
import type {
  createKnowledgeRepository,
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  KnowledgeConflictError,
} from './knowledge.model.js';

export function createKnowledgeController(deps: {
  knowledge: ReturnType<typeof createKnowledgeRepository>;
}): RouteDefinition[] {
  const { knowledge } = deps;

  return [
    {
      method: 'get',
      path: '/api/knowledge',
      handler: ({ query }) => ({
        status: 200,
        data: knowledge.list({
          collection: query.collection || undefined,
          tag:        query.tag        || undefined,
          q:          query.q          || undefined,
        }),
      }),
    },
    {
      method: 'get',
      path: '/api/knowledge/collections',
      handler: () => ({ status: 200, data: knowledge.listCollections() }),
    },
    {
      method: 'get',
      path: '/api/knowledge/prompt',
      handler: ({ query }) => {
        const collections = typeof query.collection === 'string' && query.collection
          ? query.collection.split(',').map(s => s.trim()).filter(Boolean)
          : undefined;
        const slugs = typeof query.slugs === 'string' && query.slugs
          ? query.slugs.split(',').map(s => s.trim()).filter(Boolean)
          : undefined;
        const markdown = knowledge.renderPromptContext({ collections, slugs });
        return { status: 200, data: { markdown } };
      },
    },
    {
      method: 'get',
      path: '/api/knowledge/:slug',
      handler: ({ params }) => {
        const entry = knowledge.get(params.slug);
        return entry
          ? { status: 200, data: entry }
          : { status: 404, data: { error: 'Knowledge entry not found' } };
      },
    },
    {
      method: 'get',
      path: '/api/knowledge/:slug/revisions',
      handler: ({ params, query }) => {
        const limit = query.limit ? Number(query.limit) : 50;
        return { status: 200, data: knowledge.listRevisions(params.slug, limit) };
      },
    },
    {
      method: 'post',
      path: '/api/knowledge',
      handler: ({ body }) => {
        const input = body as Partial<CreateKnowledgeInput>;
        if (!input.slug || !input.title) {
          return { status: 400, data: { error: 'slug and title are required' } };
        }
        try {
          return { status: 201, data: knowledge.create(input as CreateKnowledgeInput) };
        } catch (err) {
          if ((err as KnowledgeConflictError).code === 'SLUG_CONFLICT') {
            return { status: 409, data: { error: (err as Error).message } };
          }
          throw err;
        }
      },
    },
    {
      method: 'patch',
      path: '/api/knowledge/:slug',
      handler: ({ params, body }) => {
        try {
          const updated = knowledge.update(params.slug, body as UpdateKnowledgeInput);
          return updated
            ? { status: 200, data: updated }
            : { status: 404, data: { error: 'Knowledge entry not found' } };
        } catch (err) {
          if ((err as KnowledgeConflictError).code === 'SLUG_CONFLICT') {
            return { status: 409, data: { error: (err as Error).message } };
          }
          throw err;
        }
      },
    },
    {
      method: 'delete',
      path: '/api/knowledge/:slug',
      handler: ({ params }) => ({ status: 200, data: knowledge.delete(params.slug) }),
    },
  ];
}
