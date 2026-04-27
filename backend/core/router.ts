/**
 * Framework-agnostic route definitions.
 * Controllers return these; adapters (Express, raw HTTP, IPC) consume them.
 */

export interface RouteContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

export interface RouteResult {
  status: number;
  data: unknown;
}

export type RouteHandler = (ctx: RouteContext) => RouteResult | Promise<RouteResult>;

export interface RouteDefinition {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  handler: RouteHandler;
}

/**
 * SSE stream routes need special handling — they don't fit the { status, data } pattern.
 * These are registered separately by adapters that support streaming.
 *
 * `method` defaults to 'get' for backwards compatibility; 'post' is needed
 * for streams that accept a request body (e.g. chat turns).
 */
export interface StreamRouteDefinition {
  method?: 'get' | 'post';
  path: string;
  handler: (ctx: RouteContext, stream: StreamWriter) => void | Promise<void>;
}

export interface StreamWriter {
  writeEvent(event: string, data: unknown): void;
  end(): void;
  onClose(cb: () => void): void;
}
