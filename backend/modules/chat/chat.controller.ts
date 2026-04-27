import type { RouteDefinition, StreamRouteDefinition } from '../../core/router.js';
import type { ChatService } from './chat.service.js';

/**
 * Chat controller — exposes per-goal conversation + streaming turn
 * endpoints. The heavy lifting (claude subprocess, tool dispatch) lives
 * in chat.service.ts.
 */
export function createChatController(deps: {
  chatService: ChatService;
}): { routes: RouteDefinition[]; streamRoutes: StreamRouteDefinition[] } {
  const { chatService } = deps;

  const routes: RouteDefinition[] = [
    {
      method: 'get',
      path: '/api/goals/:id/chat',
      handler: ({ params }) => ({ status: 200, data: chatService.history(params.id) }),
    },
    {
      method: 'delete',
      path: '/api/goals/:id/chat',
      handler: ({ params }) => ({ status: 200, data: chatService.clear(params.id) }),
    },
  ];

  const streamRoutes: StreamRouteDefinition[] = [
    {
      // Send a user message and stream the assistant's turn.
      method: 'post',
      path: '/api/goals/:id/chat',
      handler: async ({ params, body }, stream) => {
        const content = ((body as Record<string, unknown>)?.content as string) || '';
        const abort = new AbortController();
        stream.onClose(() => abort.abort());
        try {
          for await (const ev of chatService.sendUserMessage(params.id, content, abort.signal)) {
            stream.writeEvent(ev.type, ev);
            if (ev.type === 'done' || ev.type === 'error') break;
          }
        } catch (e) {
          stream.writeEvent('error', { error: e instanceof Error ? e.message : String(e) });
        } finally {
          stream.end();
        }
      },
    },
    {
      // Confirm (or decline) a pending tool_use. Streams the continuation.
      method: 'post',
      path: '/api/goals/:id/chat/confirm',
      handler: async ({ params, body }, stream) => {
        const b = (body as Record<string, unknown>) || {};
        const toolUseId = String(b.toolUseId ?? '');
        const accept = b.accept === true;
        const patch = (b.patch as Record<string, unknown> | undefined);
        if (!toolUseId) {
          stream.writeEvent('error', { error: 'toolUseId is required' });
          stream.end();
          return;
        }
        const abort = new AbortController();
        stream.onClose(() => abort.abort());
        try {
          for await (const ev of chatService.confirmToolUse(params.id, toolUseId, accept, patch, abort.signal)) {
            stream.writeEvent(ev.type, ev);
            if (ev.type === 'done' || ev.type === 'error') break;
          }
        } catch (e) {
          stream.writeEvent('error', { error: e instanceof Error ? e.message : String(e) });
        } finally {
          stream.end();
        }
      },
    },
  ];

  return { routes, streamRoutes };
}
