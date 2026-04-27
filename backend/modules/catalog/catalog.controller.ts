/**
 * Catalog — Browse + Install for MCPs (Smithery) and Skills (skills.sh).
 *
 * Design: a stateful *service* exposes the install/job logic, and thin
 * *route* / *stream* wrappers bolt it onto HTTP. The IPC bridge calls the
 * service object directly so we don't duplicate job state between transports.
 *
 *   MCP install     = async: translate Smithery manifest → `.mcp.json` +
 *                     insert/update in `mcp_connections`. When the picked
 *                     connection is a remote HTTP MCP that 401s on probe,
 *                     run the MCP OAuth 2.1 flow inline — open the user's
 *                     browser to the issuer's authorize endpoint, catch the
 *                     code on a loopback listener, exchange for tokens, and
 *                     persist them under `config.oauth`. The refresh worker
 *                     keeps the bearer header fresh.
 *   Skill install   = async: spawn `npx skills add <url> --skill <slug>` and
 *                     expose an install job whose stdout/stderr the client
 *                     can stream (via SSE) or poll (via /state endpoint).
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { RouteDefinition, StreamRouteDefinition } from '../../core/router.js';
import type { PathConfig } from '../../core/paths.js';
import type { createMcpRepository } from '../mcp/mcp.model.js';
import type { createSkillsRepository } from '../skills/skills.model.js';
import type { createMcpCatalog } from './mcp-catalog.model.js';
import type { createSkillCatalog } from './skill-catalog.model.js';
import type { CatalogMcpConnection, CatalogMcpDetail, CatalogMcpList, CatalogSkill, CatalogSkillList, McpOAuthState } from '../../core/types.js';
import { writeMcpJson } from '../mcp/mcp-sync.js';
import { runMcpOAuthFlow } from './mcp-oauth-flow.js';

export interface InstallJobLine {
  ts: number;
  stream: 'stdout' | 'stderr' | 'status' | 'auth_url';
  line: string;
}

export interface InstallJobState {
  id: string;
  done: boolean;
  exitCode: number | null;
  error: string | null;
  lines: InstallJobLine[];
}

interface InstallJob extends InstallJobState {
  createdAt: number;
  emitter: EventEmitter;
}

const JOB_TTL_MS = 10 * 60_000;
const MAX_LINES_KEPT = 500;

export interface CatalogService {
  mcpList: (params: { q?: string; page?: number; pageSize?: number }) => Promise<CatalogMcpList>;
  mcpGet: (qualifiedName: string) => Promise<CatalogMcpDetail | null>;
  mcpInstallStart: (qualifiedName: string, userConfig: Record<string, unknown>) => { jobId: string };
  skillList: (params: { q?: string; org?: string; page?: number; pageSize?: number }) => Promise<CatalogSkillList>;
  skillGet: (owner: string, repo: string, slug: string) => Promise<CatalogSkill | null>;
  skillInstallStart: (owner: string, repo: string, slug: string) => { jobId: string };
  jobState: (jobId: string) => InstallJobState | null;
  subscribeJob: (jobId: string, onLine: (l: InstallJobLine) => void, onDone: (s: InstallJobState) => void) => (() => void) | null;
}

function pickConnection(connections: CatalogMcpConnection[]): CatalogMcpConnection | null {
  if (!connections.length) return null;
  // Prefer local stdio over remote — user controls the process.
  return connections.find(c => c.type === 'stdio') ?? connections[0];
}

function buildMcpJsonEntry(
  connection: CatalogMcpConnection,
  userConfig: Record<string, unknown>,
): Record<string, unknown> {
  if (connection.type === 'http') {
    if (!connection.deploymentUrl) throw new Error('HTTP connection is missing deploymentUrl');
    return { type: 'http', url: connection.deploymentUrl };
  }
  if (!connection.command) throw new Error('stdio connection is missing command');

  const mergedEnv: Record<string, string> = { ...(connection.env ?? {}) };
  for (const [key, value] of Object.entries(userConfig)) {
    if (value == null) continue;
    mergedEnv[key] = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value);
  }

  const entry: Record<string, unknown> = { command: connection.command };
  if (connection.args && connection.args.length) entry.args = connection.args;
  if (Object.keys(mergedEnv).length) entry.env = mergedEnv;
  return entry;
}

export function createCatalogService(deps: {
  mcpCatalog: ReturnType<typeof createMcpCatalog>;
  skillCatalog: ReturnType<typeof createSkillCatalog>;
  mcp: ReturnType<typeof createMcpRepository>;
  skills: ReturnType<typeof createSkillsRepository>;
  paths: PathConfig;
  openUrl?: (url: string) => void | Promise<void>;
}): CatalogService {
  const { mcpCatalog, skillCatalog, mcp, paths, openUrl } = deps;
  const jobs = new Map<string, InstallJob>();

  function pushLine(job: InstallJob, s: InstallJobLine['stream'], line: string): void {
    const entry: InstallJobLine = { ts: Date.now(), stream: s, line };
    job.lines.push(entry);
    if (job.lines.length > MAX_LINES_KEPT) job.lines.shift();
    job.emitter.emit('line', entry);
  }

  function markDone(job: InstallJob, exitCode: number, error: string | null): void {
    job.done = true;
    job.exitCode = exitCode;
    job.error = error;
    job.emitter.emit('done', job);
  }

  function pruneOldJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) if (job.done && job.createdAt < cutoff) jobs.delete(id);
  }

  function createJob(idPrefix: string): InstallJob {
    pruneOldJobs();
    const id = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: InstallJob = {
      id,
      createdAt: Date.now(),
      done: false,
      exitCode: null,
      error: null,
      lines: [],
      emitter: new EventEmitter(),
    };
    jobs.set(id, job);
    return job;
  }

  async function runMcpInstall(
    job: InstallJob,
    qualifiedName: string,
    userConfig: Record<string, unknown>,
  ): Promise<void> {
    try {
      pushLine(job, 'status', `Fetching manifest for ${qualifiedName}…`);
      const detail = await mcpCatalog.get(qualifiedName);
      if (!detail) throw new Error('MCP not found in catalog');
      const connection = pickConnection(detail.connections);
      if (!connection) throw new Error('No installable connection in manifest');

      const entry = buildMcpJsonEntry(connection, userConfig);

      // If this is a remote HTTP MCP, see if the server wants us to sign in.
      let oauthState: McpOAuthState | null = null;
      if (connection.type === 'http' && connection.deploymentUrl) {
        pushLine(job, 'status', `Probing ${connection.deploymentUrl} for auth requirements…`);
        try {
          const flow = await runMcpOAuthFlow({
            mcpUrl: connection.deploymentUrl,
            clientName: `SEO Automator – ${detail.displayName || qualifiedName}`,
            openUrl,
            onStatus: (s) => {
              if (s.phase === 'awaiting_user' && s.authUrl) {
                pushLine(job, 'auth_url', s.authUrl);
              }
              pushLine(job, 'status', s.message);
            },
          });
          oauthState = flow.state;
        } catch (err) {
          const msg = (err as Error).message;
          // "Server did not challenge" means the endpoint is open — not an error.
          if (!/not challenge/i.test(msg)) throw err;
          pushLine(job, 'status', 'No authentication required — continuing.');
        }
      }

      const finalConfig: Record<string, unknown> = oauthState
        ? { ...entry, oauth: oauthState }
        : entry;

      const existing = mcp.list().find(row => row.name === detail.qualifiedName);
      if (existing) mcp.update(existing.id, { config: finalConfig });
      else          mcp.create({ name: detail.qualifiedName, url: '', config: finalConfig });

      try { writeMcpJson(paths, mcp); }
      catch (err) {
        pushLine(job, 'stderr', `writeMcpJson failed: ${(err as Error).message}`);
      }

      pushLine(job, 'status', `✓ installed ${detail.qualifiedName}`);
      markDone(job, 0, null);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      pushLine(job, 'stderr', msg);
      markDone(job, 1, msg);
    }
  }

  return {
    mcpList: (p) => mcpCatalog.list(p),
    mcpGet: (q) => mcpCatalog.get(q),

    mcpInstallStart(qualifiedName, userConfig) {
      const job = createJob('mcp-install');
      // Fire-and-forget; state is surfaced via the job stream.
      void runMcpInstall(job, qualifiedName, userConfig);
      return { jobId: job.id };
    },

    skillList: (p) => skillCatalog.list(p),
    skillGet: (o, r, s) => skillCatalog.get(o, r, s),

    skillInstallStart(owner, repo, slug) {
      const re = /^[A-Za-z0-9._-]+$/;
      if (!re.test(owner) || !re.test(repo) || !re.test(slug)) {
        throw new Error('Invalid owner/repo/slug');
      }
      const job = createJob('skill-install');

      const githubUrl = `https://github.com/${owner}/${repo}`;
      pushLine(job, 'status', `Running: npx --yes skills add ${githubUrl} --skill ${slug}`);

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('npx', ['--yes', 'skills', 'add', githubUrl, '--skill', slug], {
          cwd: paths.projectDir,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const msg = (err as Error).message;
        pushLine(job, 'stderr', `spawn failed: ${msg}`);
        markDone(job, 1, msg);
        return { jobId: job.id };
      }

      const onData = (s: 'stdout' | 'stderr') => (chunk: Buffer): void => {
        for (const line of chunk.toString('utf-8').split(/\r?\n/)) {
          if (line.length > 0) pushLine(job, s, line);
        }
      };
      child.stdout?.on('data', onData('stdout'));
      child.stderr?.on('data', onData('stderr'));
      child.on('error', (err) => {
        pushLine(job, 'stderr', `process error: ${err.message}`);
        markDone(job, 1, err.message);
      });
      child.on('close', (code) => {
        pushLine(job, 'status', code === 0
          ? `✓ installed ${owner}/${repo}/${slug}`
          : `✗ exited with code ${code}`);
        markDone(job, code ?? 1, code === 0 ? null : `exit ${code}`);
      });

      return { jobId: job.id };
    },

    jobState(jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      return {
        id: job.id,
        done: job.done,
        exitCode: job.exitCode,
        error: job.error,
        lines: job.lines.slice(),
      };
    },

    subscribeJob(jobId, onLine, onDone) {
      const job = jobs.get(jobId);
      if (!job) return null;
      // Replay existing lines first so the subscriber doesn't miss anything.
      for (const l of job.lines) onLine(l);
      if (job.done) {
        onDone({ id: job.id, done: true, exitCode: job.exitCode, error: job.error, lines: job.lines.slice() });
        return () => {};
      }
      const lineHandler = (l: InstallJobLine): void => onLine(l);
      const doneHandler = (): void => {
        onDone({ id: job.id, done: true, exitCode: job.exitCode, error: job.error, lines: job.lines.slice() });
      };
      job.emitter.on('line', lineHandler);
      job.emitter.once('done', doneHandler);
      return () => {
        job.emitter.off('line', lineHandler);
        job.emitter.off('done', doneHandler);
      };
    },
  };
}

export function createCatalogController(
  service: CatalogService,
): { routes: RouteDefinition[]; streamRoutes: StreamRouteDefinition[] } {
  const routes: RouteDefinition[] = [
    {
      method: 'get', path: '/api/catalog/mcps',
      handler: async ({ query }) => {
        try {
          const data = await service.mcpList({
            q: query.q || undefined,
            page: query.page ? Number(query.page) : 1,
            pageSize: query.pageSize ? Number(query.pageSize) : 24,
          });
          return { status: 200, data };
        } catch (err) {
          return { status: 502, data: { error: `Smithery unreachable: ${(err as Error).message}` } };
        }
      },
    },
    {
      method: 'get', path: '/api/catalog/mcps/:qualifiedName',
      handler: async ({ params }) => {
        try {
          const detail = await service.mcpGet(params.qualifiedName);
          return detail
            ? { status: 200, data: detail }
            : { status: 404, data: { error: 'MCP not found in catalog' } };
        } catch (err) {
          return { status: 502, data: { error: `Smithery unreachable: ${(err as Error).message}` } };
        }
      },
    },
    {
      method: 'post', path: '/api/catalog/mcps/:qualifiedName/install',
      handler: ({ params, body }) => {
        const config = (body as { config?: Record<string, unknown> })?.config ?? {};
        try {
          const { jobId } = service.mcpInstallStart(params.qualifiedName, config);
          return { status: 202, data: { jobId, streamUrl: `/api/catalog/install-stream/${jobId}` } };
        } catch (err) {
          return { status: 400, data: { error: (err as Error).message } };
        }
      },
    },
    {
      method: 'get', path: '/api/catalog/skills',
      handler: async ({ query }) => {
        try {
          const data = await service.skillList({
            q: query.q || undefined,
            org: query.org || undefined,
            page: query.page ? Number(query.page) : 1,
            pageSize: query.pageSize ? Number(query.pageSize) : 24,
          });
          return { status: 200, data };
        } catch (err) {
          return { status: 502, data: { error: `skills.sh unreachable: ${(err as Error).message}` } };
        }
      },
    },
    {
      method: 'get', path: '/api/catalog/skills/:owner/:repo/:slug',
      handler: async ({ params }) => {
        try {
          const detail = await service.skillGet(params.owner, params.repo, params.slug);
          return detail
            ? { status: 200, data: detail }
            : { status: 404, data: { error: 'Skill not found' } };
        } catch (err) {
          return { status: 502, data: { error: `skills.sh unreachable: ${(err as Error).message}` } };
        }
      },
    },
    {
      method: 'post', path: '/api/catalog/skills/:owner/:repo/:slug/install',
      handler: ({ params }) => {
        try {
          const { jobId } = service.skillInstallStart(params.owner, params.repo, params.slug);
          return { status: 202, data: { jobId, streamUrl: `/api/catalog/install-stream/${jobId}` } };
        } catch (err) {
          return { status: 400, data: { error: (err as Error).message } };
        }
      },
    },
    {
      method: 'get', path: '/api/catalog/install-stream/:jobId/state',
      handler: ({ params }) => {
        const state = service.jobState(params.jobId);
        return state
          ? { status: 200, data: state }
          : { status: 404, data: { error: 'Job not found or expired' } };
      },
    },
  ];

  const streamRoutes: StreamRouteDefinition[] = [
    {
      path: '/api/catalog/install-stream/:jobId',
      handler: ({ params }, stream) => {
        const unsubscribe = service.subscribeJob(
          params.jobId,
          (line) => stream.writeEvent('line', line),
          (finalState) => {
            stream.writeEvent('done', { exitCode: finalState.exitCode, error: finalState.error });
            stream.end();
          },
        );
        if (!unsubscribe) {
          stream.writeEvent('error', { error: 'Job not found or expired' });
          stream.end();
          return;
        }
        stream.onClose(unsubscribe);
      },
    },
  ];

  return { routes, streamRoutes };
}
