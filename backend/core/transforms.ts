/**
 * Database row ↔ camelCase transforms.
 *
 * Convention: DB columns are snake_case, JS/TS objects are camelCase.
 * Every module that reads from the DB converts via one of these helpers.
 * Every module that writes to the DB uses the *_FIELDS map to turn a
 * Partial<T> patch into a SET clause.
 */

import type {
  Goal, Job, Action, McpConnection,
  Task, TaskArtifact, VerificationSpec, OnDoneTaskSpec, ReviewHistoryEntry,
  ChatMessage, ChatToolCall,
  Knowledge,
} from './types.js';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const GOAL_FIELDS: Record<string, string> = {
  title: 'title',
  status: 'status',
  targetCount: 'target_count',
  currentCount: 'current_count',
  context: 'context',
  agentType: 'agent_type',
  cronExpression: 'cron_expression',
  lastRunAt: 'last_run_at',
  nextRunAt: 'next_run_at',
  completedAt: 'completed_at',
};

export function goalToCamel(row: Row): Goal {
  return {
    id: String(row.id),
    title: row.title as string,
    status: row.status as Goal['status'],
    targetCount: row.target_count as number | null,
    currentCount: (row.current_count as number) || 0,
    jobs: [],
    context: JSON.parse((row.context as string) || '{}'),
    agentType: (row.agent_type as string) || 'seo',
    cronExpression: (row.cron_expression as string) || null,
    lastRunAt: (row.last_run_at as string) || null,
    nextRunAt: (row.next_run_at as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string) || null,
  };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JOB_FIELDS: Record<string, string> = {
  status: 'status',
  completedAt: 'completed_at',
};

export function jobToCamel(row: Row): Job {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    status: row.status as Job['status'],
    actions: [],
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) || null,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ACTION_FIELDS: Record<string, string> = {
  actionType: 'action_type',
  config: 'config',
  status: 'status',
  resultSummary: 'result_summary',
  sequenceOrder: 'sequence_order',
  pid: 'pid',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  exitCode: 'exit_code',
  error: 'error',
  completedAt: 'completed_at',
};

export function actionToCamel(row: Row): Action {
  return {
    id: String(row.id),
    jobId: row.job_id ? String(row.job_id) : null,
    actionType: (row.action_type as string) || '',
    config: JSON.parse((row.config as string) || '{}'),
    status: row.status as Action['status'],
    resultSummary: (row.result_summary as string) || '',
    sequenceOrder: (row.sequence_order as number) || 0,
    pid: (row.pid as number) || null,
    startedAt: (row.started_at as string) || null,
    finishedAt: (row.finished_at as string) || null,
    exitCode: row.exit_code != null ? (row.exit_code as number) : null,
    error: (row.error as string) || null,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) || null,
  };
}

// ---------------------------------------------------------------------------
// MCP connections
// ---------------------------------------------------------------------------

export const MCP_FIELDS: Record<string, string> = {
  name: 'name',
  url: 'url',
  config: 'config',
};

export function mcpToCamel(row: Row): McpConnection {
  return {
    id: String(row.id),
    name: row.name as string,
    url: (row.url as string) || '',
    config: JSON.parse((row.config as string) || '{}'),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_FIELDS: Record<string, string> = {
  type: 'type',
  title: 'title',
  description: 'description',
  payload: 'payload',
  status: 'status',
  priority: 'priority',
  reason: 'reason',
  source: 'source',
  runId: 'run_id',
  artifacts: 'artifacts',
  summary: 'summary',
  definitionOfDone: 'definition_of_done',
  verification: 'verification',
  onDone: 'on_done',
  reviewFeedback: 'review_feedback',
  reviewHistory: 'review_history',
  scheduledFor: 'scheduled_for',
  completedAt: 'completed_at',
};

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try { return JSON.parse(raw as string) as T; } catch { return fallback; }
}

export function taskToCamel(row: Row): Task {
  let artifacts: TaskArtifact[] = [];
  try {
    const parsed = JSON.parse((row.artifacts as string) || '[]');
    if (Array.isArray(parsed)) artifacts = parsed as TaskArtifact[];
  } catch { /* leave empty */ }

  const verification = row.verification
    ? parseJsonField<VerificationSpec | null>(row.verification, null)
    : null;
  const onDone = parseJsonField<OnDoneTaskSpec[]>(row.on_done, []);
  const reviewHistory = parseJsonField<ReviewHistoryEntry[]>(row.review_history, []);

  return {
    id: String(row.id),
    type: row.type as Task['type'],
    title: row.title as string,
    description: (row.description as string) || '',
    payload: JSON.parse((row.payload as string) || '{}'),
    status: row.status as Task['status'],
    priority: (row.priority as number) ?? 3,
    reason: (row.reason as string) || '',
    source: (row.source as Task['source']) || 'manual',
    runId: (row.run_id as string) || null,
    artifacts,
    summary: (row.summary as string) || '',
    definitionOfDone: (row.definition_of_done as string) || '',
    verification,
    onDone: Array.isArray(onDone) ? onDone : [],
    reviewFeedback: (row.review_feedback as string) || null,
    reviewHistory: Array.isArray(reviewHistory) ? reviewHistory : [],
    scheduledFor: (row.scheduled_for as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string) || null,
  };
}

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------

export function messageToCamel(row: Row): ChatMessage {
  const toolCalls = parseJsonField<ChatToolCall[]>(row.tool_calls, []);
  let toolResult: unknown = null;
  if (row.tool_result != null && row.tool_result !== '') {
    try { toolResult = JSON.parse(row.tool_result as string); } catch { toolResult = row.tool_result; }
  }
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    role: row.role as ChatMessage['role'],
    content: (row.content as string) || '',
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    toolUseId: (row.tool_use_id as string) || null,
    toolResult,
    model: (row.model as string) || null,
    createdAt: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export const KNOWLEDGE_FIELDS: Record<string, string> = {
  slug: 'slug',
  title: 'title',
  collection: 'collection',
  tags: 'tags',
  content: 'content',
  contentType: 'content_type',
  source: 'source',
};

export function knowledgeToCamel(row: Row): Knowledge {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse((row.tags as string) || '[]');
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch { /* fall through to empty array */ }
  return {
    id: String(row.id),
    slug: row.slug as string,
    title: row.title as string,
    collection: (row.collection as string) || 'general',
    tags,
    content: (row.content as string) || '',
    contentType: ((row.content_type as string) || 'markdown') as Knowledge['contentType'],
    source: (row.source as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
