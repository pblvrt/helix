/**
 * IPC Bridge — maps Electron IPC channels to repository and service calls.
 * One handler per channel; the renderer calls window.electronAPI.invoke(channel, ...args).
 */

import { ipcMain } from 'electron';
import cron from 'node-cron';
import type Database from 'better-sqlite3';
import type { createUserConfigRepository } from '../backend/modules/config/user-config.model.js';
import type { createSchedulesRepository } from '../backend/modules/schedules/schedules.model.js';
import type { createGoalsRepository } from '../backend/modules/goals/goals.model.js';
import type { createMcpRepository } from '../backend/modules/mcp/mcp.model.js';
import type { createTasksRepository } from '../backend/modules/tasks/tasks.model.js';
import type { createAgentsRepository } from '../backend/modules/agents/agents.model.js';
import type { createKnowledgeRepository } from '../backend/modules/knowledge/knowledge.model.js';
import type { createSkillsRepository } from '../backend/modules/skills/skills.model.js';
import type { CatalogService } from '../backend/modules/catalog/catalog.controller.js';
import { writeMcpJson } from '../backend/modules/mcp/mcp-sync.js';
import type { createFilesRepository } from '../backend/modules/files/files.model.js';
import type { PathConfig } from '../backend/core/paths.js';
import type { createActionsRepository } from '../backend/modules/actions/actions.model.js';
import type { createJobManager } from '../backend/modules/actions/job-manager.js';
import type { createGoalRunner } from '../backend/modules/goals/goal-runner.js';
import type { createScheduler } from '../backend/modules/schedules/scheduler.js';
import type { Schedule, TaskStatus } from '../backend/core/types.js';
import { actionToCamel } from '../backend/core/transforms.js';
import type { ChatService } from '../backend/modules/chat/chat.service.js';

export interface IpcDeps {
  db: Database.Database;
  userConfigRepo: ReturnType<typeof createUserConfigRepository>;
  schedulesRepo: ReturnType<typeof createSchedulesRepository>;
  goalsRepo: ReturnType<typeof createGoalsRepository>;
  mcpRepo: ReturnType<typeof createMcpRepository>;
  tasksRepo: ReturnType<typeof createTasksRepository>;
  agentsRepo: ReturnType<typeof createAgentsRepository>;
  knowledgeRepo: ReturnType<typeof createKnowledgeRepository>;
  filesRepo: ReturnType<typeof createFilesRepository>;
  skillsRepo: ReturnType<typeof createSkillsRepository>;
  catalogService: CatalogService;
  paths: PathConfig;
  actionsRepo: ReturnType<typeof createActionsRepository>;
  jobManager: ReturnType<typeof createJobManager>;
  goalRunner: ReturnType<typeof createGoalRunner>;
  scheduler: ReturnType<typeof createScheduler>;
  chatService: ChatService;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const {
    db, userConfigRepo, schedulesRepo, actionsRepo,
    jobManager, goalRunner, scheduler, goalsRepo, mcpRepo, tasksRepo, agentsRepo, knowledgeRepo,
    filesRepo, skillsRepo, catalogService, paths, chatService,
  } = deps;

  // --- User Config ---
  ipcMain.handle('user-config:get', () => userConfigRepo.get());
  ipcMain.handle('user-config:save', (_, config) => userConfigRepo.save(config));
  ipcMain.handle('user-config:exists', () => userConfigRepo.status());

  // --- Actions ---
  ipcMain.handle('actions:commands', () => actionsRepo.getCommands());
  ipcMain.handle('actions:status', () => actionsRepo.getStatus());
  ipcMain.handle('actions:stop', () => jobManager.stopActive());
  ipcMain.handle('actions:submit', (_, command: string, args?: string) => {
    const runId = jobManager.submit(command, args ? { args } : undefined);
    return { runId };
  });
  ipcMain.handle('actions:stop-run', (_, actionId: string) => jobManager.stop(actionId));
  ipcMain.handle('actions:queue', () => jobManager.getQueue());
  ipcMain.handle('actions:history', () => {
    const rows = db.prepare(
      'SELECT * FROM actions WHERE started_at IS NOT NULL ORDER BY started_at DESC LIMIT 20'
    ).all();
    return rows.map((r: any) => actionToCamel(r));
  });
  ipcMain.handle('actions:get', (_, id) => {
    const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
    return row ? actionToCamel(row as any) : null;
  });
  ipcMain.handle('actions:log', (_, id) => {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(paths.runsDir, `${id}.jsonl`);
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).map((l: string) => {
      try { return JSON.parse(l); } catch { return { type: 'text', data: { content: l }, timestamp: 0 }; }
    });
  });

  // --- Schedules ---
  ipcMain.handle('schedules:list', () => schedulesRepo.list());
  ipcMain.handle('schedules:create', (_, data: { command: string; cronExpression: string; description?: string; enabled?: boolean }) => {
    if (!data.command || !data.cronExpression) throw new Error('command and cronExpression required');
    if (!cron.validate(data.cronExpression)) throw new Error('Invalid cron expression');
    if (!actionsRepo.getCommandMap()[data.command]) throw new Error(`Unknown command: ${data.command}`);
    const schedule = schedulesRepo.create(data);
    if (schedule.enabled) scheduler.startJob(schedule);
    return schedule;
  });
  ipcMain.handle('schedules:update', (_, id: string, data: Partial<Schedule>) => {
    const old = schedulesRepo.list().find(s => s.id === id);
    if (!old) throw new Error('Not found');
    const updated = schedulesRepo.update(id, data);
    if (!updated) throw new Error('Not found');
    if (data.cronExpression || data.enabled !== undefined) {
      scheduler.stopJob(old.id);
      if (updated.enabled) scheduler.startJob(updated);
    }
    return updated;
  });
  ipcMain.handle('schedules:delete', (_, id: string) => {
    const result = schedulesRepo.delete(id);
    if (!result) throw new Error('Not found');
    scheduler.stopJob(id);
    return result;
  });

  // --- Goals ---
  ipcMain.handle('goals:list', () => goalsRepo.list());
  ipcMain.handle('goals:get', (_, id) => goalsRepo.getWithJobs(id));
  ipcMain.handle('goals:create', (_, data) => goalsRepo.create(data));
  ipcMain.handle('goals:update', (_, id, data) => goalsRepo.update(id, data));
  ipcMain.handle('goals:delete', (_, id) => goalsRepo.delete(id));
  ipcMain.handle('goals:start', (_, id) => {
    goalRunner.start(id);
    return goalsRepo.getWithJobs(id);
  });
  ipcMain.handle('goals:stop', (_, id) => {
    goalRunner.stopGoal(id);
    return goalsRepo.getWithJobs(id);
  });

  // --- MCP Connections ---
  ipcMain.handle('mcp:list', () => mcpRepo.list());
  ipcMain.handle('mcp:get', (_, id) => mcpRepo.get(id));
  function syncMcpFile(): void {
    try { writeMcpJson(paths, mcpRepo); }
    catch (err) { console.warn(`[ipc mcp] writeMcpJson failed: ${(err as Error).message}`); }
  }
  ipcMain.handle('mcp:create', (_, data) => {
    if (!data?.name?.trim()) throw new Error('name is required');
    const created = mcpRepo.create(data);
    syncMcpFile();
    return created;
  });
  ipcMain.handle('mcp:update', (_, id, data) => {
    const result = mcpRepo.update(id, data);
    if (!result) throw new Error('Connection not found');
    syncMcpFile();
    return result;
  });
  ipcMain.handle('mcp:delete', (_, id) => {
    const result = mcpRepo.delete(id);
    syncMcpFile();
    return result;
  });
  ipcMain.handle('mcp:list-for-goal', (_, goalId) => mcpRepo.listForGoal(goalId));
  ipcMain.handle('mcp:set-for-goal', (_, goalId, mcpIds) => {
    if (!Array.isArray(mcpIds)) throw new Error('mcpIds must be an array');
    mcpRepo.setForGoal(goalId, mcpIds.map(String));
    return mcpRepo.listForGoal(goalId);
  });

  // --- Tasks ---
  ipcMain.handle('tasks:list', (_, opts?: { status?: TaskStatus | 'all'; limit?: number; eligibleOnly?: boolean }) =>
    tasksRepo.list(opts || {})
  );
  ipcMain.handle('tasks:counts', () => tasksRepo.counts());
  ipcMain.handle('tasks:get', (_, id: string) => tasksRepo.get(id));
  ipcMain.handle('tasks:create', (_, input) => {
    if (Array.isArray(input?.tasks)) return tasksRepo.createMany(input.tasks);
    if (!input?.type || !input?.title) throw new Error('type and title required');
    return tasksRepo.create(input);
  });
  ipcMain.handle('tasks:update', async (_, id: string, patch) => {
    const p = (patch || {}) as Record<string, unknown> & { approve?: boolean };
    const existing = tasksRepo.get(id);
    if (!existing) throw new Error('Task not found');

    // Transition to done goes through the verification path — mirror of the HTTP controller.
    if (p.status === 'done' && existing.status !== 'done') {
      const { approve, status: _ignored, ...rest } = p;
      void _ignored;
      const result = await tasksRepo.transitionToDone(id, {
        approve: approve === true,
        patch: rest as Parameters<typeof tasksRepo.update>[1],
      });
      if (!result.ok) throw new Error(result.reason);
      return { task: result.task, spawned: result.spawned };
    }

    const { approve: _approve, ...rest } = p;
    void _approve;
    const updated = tasksRepo.update(id, rest as Parameters<typeof tasksRepo.update>[1]);
    if (!updated) throw new Error('Task not found');
    return updated;
  });
  ipcMain.handle('tasks:approve', async (_, id: string) => {
    const result = await tasksRepo.transitionToDone(id, { approve: true });
    if (!result.ok && !result.task) throw new Error(result.reason);
    return { task: result.task, spawned: result.spawned };
  });
  ipcMain.handle('tasks:decline', (_, id: string, feedback: string) => {
    const trimmed = (feedback || '').trim();
    if (!trimmed) throw new Error('feedback is required');
    const updated = tasksRepo.decline(id, trimmed);
    if (!updated) throw new Error('Task not found');
    return updated;
  });
  ipcMain.handle('tasks:delete', (_, id: string) => tasksRepo.delete(id));

  // When an action completes, park the task for review rather than flipping
  // it to done. Agents never self-declare done — that's the human's (or
  // verification's) call via tasks:approve. A clean action exit means the
  // agent finished; the result still has to be checked.
  jobManager.emitter.on('job:done', (actionId: string, exitCode: number) => {
    const row = db.prepare('SELECT id FROM tasks WHERE run_id = ? AND status = ? LIMIT 1').get(actionId, 'in_progress') as { id: number } | undefined;
    if (!row) return;
    const newStatus: TaskStatus = exitCode === 0 ? 'needs_review' : 'backlog';
    tasksRepo.update(String(row.id), { status: newStatus, ...(newStatus === 'backlog' ? { runId: null } : {}) });
  });
  jobManager.emitter.on('job:error', (actionId: string) => {
    const row = db.prepare('SELECT id FROM tasks WHERE run_id = ? AND status = ? LIMIT 1').get(actionId, 'in_progress') as { id: number } | undefined;
    if (!row) return;
    tasksRepo.update(String(row.id), { status: 'backlog', runId: null });
  });

  // --- Agents ---
  ipcMain.handle('agents:list', () => agentsRepo.list());

  // --- Chat ---
  // Streaming turns go through the HTTP SSE endpoints (Electron's embedded
  // server supports them now that mount-http handles streamRoutes). Here we
  // only expose the non-streaming sides — history + clear.
  ipcMain.handle('chat:history', (_, goalId: string) => chatService.history(goalId));
  ipcMain.handle('chat:clear',   (_, goalId: string) => chatService.clear(goalId));
  ipcMain.handle('agents:get', (_, name: string) => agentsRepo.get(name));

  // --- Skills (installed) ---
  ipcMain.handle('skills:list', () => skillsRepo.list());
  ipcMain.handle('skills:get', (_, slug: string) => {
    const s = skillsRepo.get(slug);
    if (!s) throw new Error('Skill not found');
    return s;
  });
  ipcMain.handle('skills:delete', (_, slug: string) => skillsRepo.delete(slug));

  // --- Catalog (browse + install) ---
  ipcMain.handle('catalog:mcps:list', (_, params: { q?: string; page?: number; pageSize?: number } = {}) =>
    catalogService.mcpList(params)
  );
  ipcMain.handle('catalog:mcps:get', (_, qualifiedName: string) =>
    catalogService.mcpGet(qualifiedName)
  );
  ipcMain.handle('catalog:mcps:install', (_, qualifiedName: string, config: Record<string, unknown> = {}) =>
    catalogService.mcpInstallStart(qualifiedName, config)
  );
  ipcMain.handle('catalog:skills:list', (_, params: { q?: string; org?: string; page?: number; pageSize?: number } = {}) =>
    catalogService.skillList(params)
  );
  ipcMain.handle('catalog:skills:get', (_, owner: string, repo: string, slug: string) =>
    catalogService.skillGet(owner, repo, slug)
  );
  ipcMain.handle('catalog:skills:install', (_, owner: string, repo: string, slug: string) =>
    catalogService.skillInstallStart(owner, repo, slug)
  );
  ipcMain.handle('catalog:jobs:state', (_, jobId: string) => {
    const state = catalogService.jobState(jobId);
    if (!state) throw new Error('Job not found or expired');
    return state;
  });

  // --- Files (in-app viewer) ---
  ipcMain.handle('files:read',  (_, p: string)                => filesRepo.read(p));
  ipcMain.handle('files:write', (_, p: string, content: string) => filesRepo.write(p, content));

  // --- Shell open (for task artifact links) ---
  ipcMain.handle('shell:open-path', async (_, target: string) => {
    const { shell } = await import('electron');
    if (!target) throw new Error('path required');
    // shell.openPath accepts absolute fs paths; shell.openExternal handles URLs.
    if (/^https?:\/\//i.test(target)) {
      await shell.openExternal(target);
      return { ok: true };
    }
    const errMsg = await shell.openPath(target);
    if (errMsg) throw new Error(errMsg);
    return { ok: true };
  });

  // --- Knowledge ---
  ipcMain.handle('knowledge:list', (_, opts?: { collection?: string; tag?: string; q?: string }) =>
    knowledgeRepo.list(opts || {})
  );
  ipcMain.handle('knowledge:collections', () => knowledgeRepo.listCollections());
  ipcMain.handle('knowledge:prompt', (_, opts?: { collections?: string[]; slugs?: string[] }) => ({
    markdown: knowledgeRepo.renderPromptContext(opts || {}),
  }));
  ipcMain.handle('knowledge:revisions', (_, slug: string, limit?: number) =>
    knowledgeRepo.listRevisions(slug, typeof limit === 'number' ? limit : 50)
  );
  ipcMain.handle('knowledge:get', (_, slug: string) => {
    const entry = knowledgeRepo.get(slug);
    if (!entry) throw new Error('Knowledge entry not found');
    return entry;
  });
  ipcMain.handle('knowledge:create', (_, input) => {
    if (!input?.slug || !input?.title) throw new Error('slug and title are required');
    return knowledgeRepo.create(input);
  });
  ipcMain.handle('knowledge:update', (_, slug: string, patch) => {
    const updated = knowledgeRepo.update(slug, patch || {});
    if (!updated) throw new Error('Knowledge entry not found');
    return updated;
  });
  ipcMain.handle('knowledge:delete', (_, slug: string) => knowledgeRepo.delete(slug));
}
