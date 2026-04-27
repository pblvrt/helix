/**
 * Single API client. Uses Electron IPC when running in the Electron shell
 * (window.electronAPI is defined by preload.ts), otherwise uses fetch against
 * the embedded HTTP server on port 3458.
 */

import type {
  Command, ActionsStatus, LogEntry, Schedule, StreamCallback,
  Goal, Action, UserConfig, McpConnection, Task, TaskStatus, TaskType,
  Knowledge, KnowledgeContentType,
  Skill, CatalogMcpDetail, CatalogMcpList, CatalogSkill, CatalogSkillList,
} from '../../backend/core/types';

export type {
  Command, ActionsStatus, LogEntry, Schedule, StreamCallback,
  Goal, Job, Action, UserConfig, McpConnection,
  Task, TaskStatus, TaskType, TaskSource, TaskArtifact,
  VerificationSpec, OnDoneTaskSpec, ReviewHistoryEntry,
  ChatMessage, ChatToolCall, ChatRole,
  Knowledge, KnowledgeContentType,
  Skill, CatalogMcp, CatalogMcpConnection, CatalogMcpDetail, CatalogMcpList,
  CatalogSkill, CatalogSkillList,
} from '../../backend/core/types';

export async function openArtifact(target: string): Promise<void> {
  if (isElectron) { await ipc('shell:open-path', target); return; }
  // Web fallback: only http(s) works; local paths require Electron.
  if (/^https?:\/\//i.test(target)) window.open(target, '_blank');
  else alert('Local paths can only be opened from the Electron app.');
}

// ---------------------------------------------------------------------------
// Files (in-app artifact viewer)
// ---------------------------------------------------------------------------

export interface FileReadResult {
  path: string;
  kind: 'text' | 'image';
  contentType: string;
  content: string;    // text content OR data URL for images
  size: number;
  modifiedAt: string;
}

export async function readFile(path: string): Promise<FileReadResult> {
  if (isElectron) return ipc('files:read', path);
  const res = await fetch(`${API}/files?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to read file');
  }
  return res.json();
}

export async function writeFile(path: string, content: string): Promise<FileReadResult> {
  if (isElectron) return ipc('files:write', path, content);
  const res = await fetch(`${API}/files`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to write file');
  }
  return res.json();
}

const API = 'http://localhost:3458/api';
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

function ipc<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.electronAPI!.invoke(channel, ...args) as Promise<T>;
}

// ---------------------------------------------------------------------------
// User Config
// ---------------------------------------------------------------------------

export async function fetchUserConfig(): Promise<UserConfig> {
  if (isElectron) return ipc('user-config:get');
  const res = await fetch(`${API}/user-config`);
  if (!res.ok) throw new Error('Failed to fetch user config');
  return res.json();
}

export async function saveUserConfig(config: UserConfig): Promise<void> {
  if (isElectron) { await ipc('user-config:save', config); return; }
  const res = await fetch(`${API}/user-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to save user config');
}

export async function checkOnboardingStatus(): Promise<{ exists: boolean; onboardingCompleted: boolean }> {
  if (isElectron) return ipc('user-config:exists');
  const res = await fetch(`${API}/user-config/status`);
  if (!res.ok) return { exists: false, onboardingCompleted: false };
  return res.json();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function fetchActionCommands(): Promise<Command[]> {
  if (isElectron) return ipc('actions:commands');
  const res = await fetch(`${API}/actions/commands`);
  if (!res.ok) throw new Error('Failed to fetch commands');
  return res.json();
}

export async function fetchActionsStatus(): Promise<ActionsStatus> {
  if (isElectron) return ipc('actions:status');
  const res = await fetch(`${API}/actions/status`);
  if (!res.ok) throw new Error('Failed to fetch actions status');
  return res.json();
}

export async function stopActions(): Promise<void> {
  if (isElectron) { await ipc('actions:stop'); return; }
  await fetch(`${API}/actions/stop`, { method: 'POST' });
}

export async function submitAction(command: string, args?: string): Promise<{ runId: string }> {
  if (isElectron) return ipc('actions:submit', command, args);
  const res = await fetch(`${API}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to submit action');
  }
  return res.json();
}

export async function stopAction(runId: string): Promise<void> {
  if (isElectron) { await ipc('actions:stop-run', runId); return; }
  await fetch(`${API}/actions/${runId}/stop`, { method: 'POST' });
}

export async function fetchActionQueue(): Promise<Action[]> {
  if (isElectron) return ipc('actions:queue');
  const res = await fetch(`${API}/actions/queue`);
  if (!res.ok) throw new Error('Failed to fetch action queue');
  return res.json();
}

export async function fetchActionHistory(limit = 20): Promise<Action[]> {
  if (isElectron) return ipc('actions:history');
  const res = await fetch(`${API}/actions/history?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch action history');
  return res.json();
}

export async function fetchActionLog(actionId: string): Promise<LogEntry[]> {
  if (isElectron) return ipc('actions:log', actionId);
  const res = await fetch(`${API}/actions/${actionId}/log`);
  if (!res.ok) throw new Error('Log not found');
  return res.json();
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export async function fetchSchedules(): Promise<Schedule[]> {
  if (isElectron) return ipc('schedules:list');
  const res = await fetch(`${API}/schedules`);
  if (!res.ok) throw new Error('Failed to fetch schedules');
  return res.json();
}

export async function createSchedule(data: Partial<Schedule>): Promise<Schedule> {
  if (isElectron) return ipc('schedules:create', data);
  const res = await fetch(`${API}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create schedule');
  return res.json();
}

export async function updateSchedule(id: string, data: Partial<Schedule>): Promise<Schedule> {
  if (isElectron) return ipc('schedules:update', id, data);
  const res = await fetch(`${API}/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update schedule');
  return res.json();
}

export async function deleteSchedule(id: string): Promise<void> {
  if (isElectron) { await ipc('schedules:delete', id); return; }
  await fetch(`${API}/schedules/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Action log streaming
// ---------------------------------------------------------------------------

export function streamActionEvents(actionId: string, onEvent: StreamCallback): () => void {
  if (isElectron) {
    window.electronAPI!.removeAllListeners('actions:stream');
    const unsub = window.electronAPI!.on('actions:stream', (data: unknown) => {
      onEvent(data as LogEntry);
    });
    window.electronAPI!.invoke('actions:stream-log', actionId);
    return () => {
      unsub();
      window.electronAPI!.removeAllListeners('actions:stream');
    };
  }

  const es = new EventSource(`${API}/actions/${actionId}/stream`);
  const handle = (type: string) => (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: type as LogEntry['type'], data, timestamp: Date.now() });
    } catch { /* skip */ }
  };
  es.addEventListener('status', handle('status'));
  es.addEventListener('message', handle('message'));
  es.addEventListener('text', handle('text'));
  es.addEventListener('error', (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data);
      onEvent({ type: 'error', data, timestamp: Date.now() });
    } catch {
      es.close();
    }
  });
  return () => es.close();
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export async function fetchGoals(): Promise<Goal[]> {
  if (isElectron) return ipc('goals:list');
  const res = await fetch(`${API}/goals`);
  if (!res.ok) throw new Error('Failed to fetch goals');
  return res.json();
}

export async function fetchGoal(id: string): Promise<Goal> {
  if (isElectron) return ipc('goals:get', id);
  const res = await fetch(`${API}/goals/${id}`);
  if (!res.ok) throw new Error('Goal not found');
  return res.json();
}

export interface CreateGoalInput {
  title: string;
  targetCount?: number;
  cronExpression?: string;
  context?: Record<string, unknown>;
  agentType?: string;
}

export async function createGoal(data: CreateGoalInput): Promise<Goal> {
  if (isElectron) return ipc('goals:create', data);
  const res = await fetch(`${API}/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create goal');
  return res.json();
}

export async function updateGoal(id: string, data: Partial<Goal>): Promise<Goal> {
  if (isElectron) return ipc('goals:update', id, data);
  const res = await fetch(`${API}/goals/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update goal');
  return res.json();
}

export async function deleteGoal(id: string): Promise<void> {
  if (isElectron) { await ipc('goals:delete', id); return; }
  await fetch(`${API}/goals/${id}`, { method: 'DELETE' });
}

export async function startGoal(id: string): Promise<Goal> {
  if (isElectron) return ipc('goals:start', id);
  const res = await fetch(`${API}/goals/${id}/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start goal');
  return res.json();
}

export async function stopGoal(id: string): Promise<Goal> {
  if (isElectron) return ipc('goals:stop', id);
  const res = await fetch(`${API}/goals/${id}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop goal');
  return res.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`${API}/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to cancel job');
}

// ---------------------------------------------------------------------------
// MCP Connections
// ---------------------------------------------------------------------------

export async function fetchMcpConnections(): Promise<McpConnection[]> {
  if (isElectron) return ipc('mcp:list');
  const res = await fetch(`${API}/mcp-connections`);
  if (!res.ok) throw new Error('Failed to fetch MCP connections');
  return res.json();
}

export async function createMcpConnection(data: { name: string; url?: string; config?: Record<string, unknown> }): Promise<McpConnection> {
  if (isElectron) return ipc('mcp:create', data);
  const res = await fetch(`${API}/mcp-connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create MCP connection');
  return res.json();
}

export async function updateMcpConnection(id: string, data: Partial<Omit<McpConnection, 'id' | 'createdAt' | 'updatedAt'>>): Promise<McpConnection> {
  if (isElectron) return ipc('mcp:update', id, data);
  const res = await fetch(`${API}/mcp-connections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update MCP connection');
  return res.json();
}

export async function deleteMcpConnection(id: string): Promise<void> {
  if (isElectron) { await ipc('mcp:delete', id); return; }
  await fetch(`${API}/mcp-connections/${id}`, { method: 'DELETE' });
}

export async function fetchGoalMcpIds(goalId: string): Promise<string[]> {
  if (isElectron) return ipc('mcp:list-for-goal', goalId);
  const res = await fetch(`${API}/goals/${goalId}/mcp-connections`);
  if (!res.ok) throw new Error('Failed to fetch goal MCP IDs');
  return res.json();
}

export async function setGoalMcpIds(goalId: string, mcpIds: string[]): Promise<string[]> {
  if (isElectron) return ipc('mcp:set-for-goal', goalId, mcpIds);
  const res = await fetch(`${API}/goals/${goalId}/mcp-connections`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcpIds }),
  });
  if (!res.ok) throw new Error('Failed to set goal MCP IDs');
  return res.json();
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface AgentDescriptor {
  name: string;
  description: string;
  model?: string;
}

export async function fetchAgents(): Promise<AgentDescriptor[]> {
  if (isElectron) return ipc('agents:list');
  const res = await fetch(`${API}/agents`);
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function fetchTasks(opts: { status?: TaskStatus | 'all'; limit?: number } = {}): Promise<Task[]> {
  if (isElectron) return ipc('tasks:list', opts);
  const qs = new URLSearchParams();
  if (opts.status) qs.set('status', opts.status);
  if (opts.limit)  qs.set('limit', String(opts.limit));
  const res = await fetch(`${API}/tasks${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function fetchTaskCounts(): Promise<Record<TaskStatus, number>> {
  if (isElectron) return ipc('tasks:counts');
  const res = await fetch(`${API}/tasks/counts`);
  if (!res.ok) throw new Error('Failed to fetch task counts');
  return res.json();
}

export interface CreateTaskBody {
  type: TaskType;
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  reason?: string;
  source?: 'planner' | 'manual';
}

export async function createTask(body: CreateTaskBody): Promise<Task> {
  if (isElectron) return ipc('tasks:create', body);
  const res = await fetch(`${API}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create task');
  }
  return res.json();
}

/**
 * Patch fields on a task. For transitions to `done`, prefer `approveTask`
 * (sugar that sets `approve: true`). A direct PATCH with status=done still
 * works but requires the caller to pass `approve: true` or rely on a passing
 * non-manual verification. Returns the updated task — or, when the transition
 * to done fires a chain, `{ task, spawned }`.
 */
export async function updateTask(
  id: string,
  patch: Partial<Task> & { approve?: boolean },
): Promise<Task | { task: Task; spawned: Task[] }> {
  if (isElectron) return ipc('tasks:update', id, patch);
  const res = await fetch(`${API}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update task');
  }
  return res.json();
}

export async function approveTask(id: string): Promise<{ task: Task; spawned: Task[] }> {
  if (isElectron) return ipc('tasks:approve', id);
  const res = await fetch(`${API}/tasks/${id}/approve`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to approve task');
  }
  return res.json();
}

export async function declineTask(id: string, feedback: string): Promise<Task> {
  if (isElectron) return ipc('tasks:decline', id, feedback);
  const res = await fetch(`${API}/tasks/${id}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to decline task');
  }
  return res.json();
}

export async function deleteTask(id: string): Promise<{ ok: true }> {
  if (isElectron) return ipc('tasks:delete', id);
  const res = await fetch(`${API}/tasks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete task');
  return res.json();
}

// Tasks are run exclusively through the Executor (Goal → Job → Execute
// pattern). No per-task run endpoint exists — it would deadlock the
// global action queue. To move a task forward manually, use updateTask
// to set its status directly.

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export interface ListKnowledgeParams {
  collection?: string;
  tag?: string;
  q?: string;
}

export interface CreateKnowledgeBody {
  slug: string;
  title: string;
  collection?: string;
  tags?: string[];
  content?: string;
  contentType?: KnowledgeContentType;
  source?: string | null;
}

export type UpdateKnowledgeBody = Partial<CreateKnowledgeBody>;

export async function fetchKnowledge(params: ListKnowledgeParams = {}): Promise<Knowledge[]> {
  if (isElectron) return ipc('knowledge:list', params);
  const qs = new URLSearchParams();
  if (params.collection) qs.set('collection', params.collection);
  if (params.tag)        qs.set('tag', params.tag);
  if (params.q)          qs.set('q', params.q);
  const res = await fetch(`${API}/knowledge${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch knowledge');
  return res.json();
}

export async function fetchKnowledgeCollections(): Promise<string[]> {
  if (isElectron) return ipc('knowledge:collections');
  const res = await fetch(`${API}/knowledge/collections`);
  if (!res.ok) throw new Error('Failed to fetch knowledge collections');
  return res.json();
}

export async function fetchKnowledgeEntry(slug: string): Promise<Knowledge> {
  if (isElectron) return ipc('knowledge:get', slug);
  const res = await fetch(`${API}/knowledge/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error('Knowledge entry not found');
  return res.json();
}

export async function createKnowledge(body: CreateKnowledgeBody): Promise<Knowledge> {
  if (isElectron) return ipc('knowledge:create', body);
  const res = await fetch(`${API}/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create knowledge entry');
  }
  return res.json();
}

export async function updateKnowledge(slug: string, patch: UpdateKnowledgeBody): Promise<Knowledge> {
  if (isElectron) return ipc('knowledge:update', slug, patch);
  const res = await fetch(`${API}/knowledge/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update knowledge entry');
  }
  return res.json();
}

export async function deleteKnowledge(slug: string): Promise<{ ok: true }> {
  if (isElectron) return ipc('knowledge:delete', slug);
  const res = await fetch(`${API}/knowledge/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete knowledge entry');
  return res.json();
}

// ---------------------------------------------------------------------------
// Skills (installed, from .claude/skills/*/SKILL.md)
// ---------------------------------------------------------------------------

export async function fetchSkills(): Promise<Skill[]> {
  if (isElectron) return ipc('skills:list');
  const res = await fetch(`${API}/skills`);
  if (!res.ok) throw new Error('Failed to fetch skills');
  return res.json();
}

export async function fetchSkill(slug: string): Promise<Skill> {
  if (isElectron) return ipc('skills:get', slug);
  const res = await fetch(`${API}/skills/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error('Skill not found');
  return res.json();
}

export async function deleteSkill(slug: string): Promise<{ ok: true; removed: string[] }> {
  if (isElectron) return ipc('skills:delete', slug);
  const res = await fetch(`${API}/skills/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete skill');
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Catalog (Browse & Install — live from Smithery + skills.sh)
// ---------------------------------------------------------------------------

export interface ListCatalogMcpParams {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ListCatalogSkillParams {
  q?: string;
  org?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchCatalogMcps(params: ListCatalogMcpParams = {}): Promise<CatalogMcpList> {
  if (isElectron) return ipc('catalog:mcps:list', params);
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const res = await fetch(`${API}/catalog/mcps${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch MCP catalog');
  }
  return res.json();
}

export async function fetchCatalogMcp(qualifiedName: string): Promise<CatalogMcpDetail> {
  if (isElectron) return ipc('catalog:mcps:get', qualifiedName);
  const res = await fetch(`${API}/catalog/mcps/${encodeURIComponent(qualifiedName)}`);
  if (!res.ok) throw new Error('MCP not found');
  return res.json();
}

export async function startInstallCatalogMcp(qualifiedName: string, config: Record<string, unknown> = {}): Promise<{ jobId: string }> {
  if (isElectron) return ipc('catalog:mcps:install', qualifiedName, config);
  const res = await fetch(`${API}/catalog/mcps/${encodeURIComponent(qualifiedName)}/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start MCP install');
  }
  return res.json();
}

export async function fetchCatalogSkills(params: ListCatalogSkillParams = {}): Promise<CatalogSkillList> {
  if (isElectron) return ipc('catalog:skills:list', params);
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.org) qs.set('org', params.org);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const res = await fetch(`${API}/catalog/skills${qs.toString() ? `?${qs}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch skills catalog');
  }
  return res.json();
}

export async function fetchCatalogSkill(owner: string, repo: string, slug: string): Promise<CatalogSkill> {
  if (isElectron) return ipc('catalog:skills:get', owner, repo, slug);
  const res = await fetch(
    `${API}/catalog/skills/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}`,
  );
  if (!res.ok) throw new Error('Skill not found');
  return res.json();
}

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

export async function startInstallCatalogSkill(owner: string, repo: string, slug: string): Promise<{ jobId: string }> {
  if (isElectron) return ipc('catalog:skills:install', owner, repo, slug);
  const res = await fetch(
    `${API}/catalog/skills/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(slug)}/install`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start install');
  }
  return res.json();
}

export async function fetchInstallJobState(jobId: string): Promise<InstallJobState> {
  if (isElectron) return ipc('catalog:jobs:state', jobId);
  const res = await fetch(`${API}/catalog/install-stream/${encodeURIComponent(jobId)}/state`);
  if (!res.ok) throw new Error('Install job not found');
  return res.json();
}

// ---------------------------------------------------------------------------
// Chat (per-goal operator chat)
// ---------------------------------------------------------------------------

import type { ChatMessage as _ChatMsg, ChatToolCall as _ChatToolCall } from '../../backend/core/types';

/** Event shapes emitted by the chat SSE stream. Mirrors chat.service.ts. */
export type ChatStreamEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text_delta';    delta: string }
  | { type: 'tool_use_auto_start'; toolCall: _ChatToolCall }
  | { type: 'tool_use_result';     toolUseId: string; result: unknown; error?: string }
  | { type: 'tool_use_pending';    toolCalls: _ChatToolCall[] }
  | { type: 'error'; error: string }
  | { type: 'done' };

export async function fetchChatHistory(goalId: string): Promise<_ChatMsg[]> {
  if (isElectron) return ipc('chat:history', goalId);
  const res = await fetch(`${API}/goals/${goalId}/chat`);
  if (!res.ok) throw new Error('Failed to fetch chat history');
  return res.json();
}

export async function clearChatHistory(goalId: string): Promise<{ ok: true; deleted: number }> {
  if (isElectron) return ipc('chat:clear', goalId);
  const res = await fetch(`${API}/goals/${goalId}/chat`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear chat');
  return res.json();
}

/**
 * Stream a chat turn. Calls `onEvent` for each event; returns a cancel
 * function to abort the stream. Works for both POST /chat (new user
 * message) and POST /chat/confirm (tool confirmation) — `path` picks which.
 */
function openChatStream(
  goalId: string,
  path: 'send' | 'confirm',
  body: Record<string, unknown>,
  onEvent: (e: ChatStreamEvent) => void,
): () => void {
  const ctl = new AbortController();
  const url = path === 'send'
    ? `${API}/goals/${goalId}/chat`
    : `${API}/goals/${goalId}/chat/confirm`;
  (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        onEvent({ type: 'error', error: (e as Error).message });
      }
      return;
    }
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', error: `chat stream HTTP ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are "\n\n" separated. Each frame has `event: <type>\ndata: <json>`.
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = frame.split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            onEvent({ type: event as ChatStreamEvent['type'], ...parsed });
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        onEvent({ type: 'error', error: (e as Error).message });
      }
    }
  })();
  return () => ctl.abort();
}

export function streamChatTurn(
  goalId: string,
  content: string,
  onEvent: (e: ChatStreamEvent) => void,
): () => void {
  return openChatStream(goalId, 'send', { content }, onEvent);
}

export function streamChatConfirm(
  goalId: string,
  toolUseId: string,
  accept: boolean,
  patch: Record<string, unknown> | undefined,
  onEvent: (e: ChatStreamEvent) => void,
): () => void {
  return openChatStream(goalId, 'confirm', { toolUseId, accept, patch }, onEvent);
}
