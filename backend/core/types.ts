/**
 * Shared type definitions — single source of truth for all layers.
 * Frontend, server, and electron all import from here.
 */

// ---------------------------------------------------------------------------
// User Config — generic JSON blob with a few standard fields.
// Add your own domain-specific fields here.
// ---------------------------------------------------------------------------

export interface UserConfig {
  userName: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  userName: '',
  onboardingCompleted: false,
  createdAt: '',
  updatedAt: '',
};

// ---------------------------------------------------------------------------
// Commands, Actions, Jobs, Goals — the agent queue primitives.
// ---------------------------------------------------------------------------

/** A command the user can run — loaded from .claude/commands/<id>.md */
export interface Command {
  id: string;
  agent: string;
  prompt: string;
}

export interface ActionsStatus {
  running: boolean;
  activeAction: {
    id: string;
    actionType: string;
    status: string;
    pid?: number;
    startedAt: string | null;
  } | null;
}

export type ActionStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'error'
  | 'stopped'
  | 'cancelled'
  | 'crashed';

export interface LogEntry {
  type: 'status' | 'message' | 'text' | 'error';
  data: Record<string, unknown>;
  timestamp: number;
}

export type StreamCallback = (entry: LogEntry) => void;

export type GoalStatus = 'pending' | 'planning' | 'active' | 'paused' | 'completed' | 'failed';
export type JobStatus = 'pending' | 'planning' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface Goal {
  id: string;
  title: string;
  status: GoalStatus;
  targetCount: number | null;
  currentCount: number;
  jobs: Job[];
  context: Record<string, unknown>;
  agentType: string;
  cronExpression: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Job {
  id: string;
  goalId: string;
  status: JobStatus;
  actions: Action[];
  createdAt: string;
  completedAt: string | null;
}

export interface Action {
  id: string;
  jobId: string | null;
  actionType: string;
  config: Record<string, unknown>;
  status: ActionStatus;
  resultSummary: string;
  sequenceOrder: number;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Schedules — cron triggers that submit commands
// ---------------------------------------------------------------------------

export interface Schedule {
  id: string;
  command: string;
  cronExpression: string;
  enabled: boolean;
  description: string;
  lastRun: string | null;
  lastRunId: string | null;
  lastStatus: 'success' | 'error' | 'running' | 'queued' | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Tasks — the SEO agent's CRM backlog
// ---------------------------------------------------------------------------

/**
 * Task status lifecycle:
 *   backlog       — created, awaiting an agent to pick it up
 *   in_progress   — an agent is actively working on it (transient; renders
 *                   inside the Backlog column with a spinner, not its own column)
 *   needs_review  — agent finished; human must approve or decline. An agent
 *                   can never move a card past needs_review. A decline with
 *                   feedback sends it back to backlog; an approve (or a passing
 *                   verification check) advances it to done.
 *   done          — verified complete. Chained tasks in `onDone` are spawned here.
 *   blocked       — hit a wall (CAPTCHA, auth, verification failure, etc.)
 *
 * Note: 'skipped' has been retired; the review-decline flow replaces it.
 * If a task should not be done, delete it.
 */
export type TaskStatus = 'backlog' | 'in_progress' | 'needs_review' | 'done' | 'blocked';
export type TaskSource = 'planner' | 'manual' | 'chain';

/**
 * An artifact is any output a subagent produces that a human might want to
 * open: a drafted blog file, a scraped analytics JSON, a screenshot of a
 * loaded LinkedIn composer, the URL of a posted tweet, etc.
 */
export interface TaskArtifact {
  kind: 'file' | 'url' | 'screenshot' | 'note';
  path?: string;   // absolute filesystem path (for file/screenshot)
  url?: string;    // external URL (for url)
  label: string;   // human label shown in the UI
}

/**
 * Task type is a free-form string — NOT a closed enum. The convention is that
 * `type` matches a command file at `.claude/commands/<type>.md`; the executor
 * resolves it at dispatch time. Adding a new workflow means dropping a new
 * command file; no schema or type change required.
 *
 * This is intentional: the app is a general-purpose coordination engine.
 * Hardcoding the set of workflows here would force a code edit every time a
 * new domain (SEO, CRM, video editing, research, etc.) grows a new task.
 */
export type TaskType = string;

/**
 * A verification check the backend runs before flipping a task to `done`.
 * `manual` means no machine check — a human must click Approve. Absent
 * verification (null) behaves the same as `manual`.
 */
export type VerificationSpec =
  | { kind: 'file_exists';   path: string }
  | { kind: 'file_contains'; path: string; pattern: string }
  | { kind: 'url_ok';        url: string }
  | { kind: 'shell';         command: string; expectExit?: number }
  | { kind: 'manual' };

/**
 * A record of a prior Needs Review decline — appended to `reviewHistory` so
 * the agent can see all past attempts, not just the most recent feedback.
 */
export interface ReviewHistoryEntry {
  at: string;
  feedback: string;
  artifactsAtDecline: TaskArtifact[];
  summaryAtDecline: string;
}

/**
 * A follow-up task spec. When a task lands in `done`, every entry in
 * `onDone` is inserted into the backlog. Chained tasks inherit the parent's
 * `payload.goalContext` unless the spec provides its own.
 *
 * `scheduledFor` accepts either an ISO-8601 timestamp (absolute) or a
 * relative offset string (`+7d`, `+2h`, `+30m`). Relative offsets are
 * resolved to an absolute timestamp at the moment the child task is
 * inserted — so "+7d" on the parent means "7 days from when the parent
 * finished," which is the natural meaning.
 */
export interface OnDoneTaskSpec {
  type: TaskType;
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  reason?: string;
  definitionOfDone?: string;
  verification?: VerificationSpec | null;
  onDone?: OnDoneTaskSpec[];
  scheduledFor?: string | null;
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  priority: number;   // 1 (high) → 5 (low)
  reason: string;     // why the planner created this task
  source: TaskSource;
  runId: string | null;
  artifacts: TaskArtifact[];
  summary: string;    // one-line result from the agent
  definitionOfDone: string;               // prose — what "done" means
  verification: VerificationSpec | null;  // optional machine check
  onDone: OnDoneTaskSpec[];               // follow-up tasks spawned on done
  reviewFeedback: string | null;          // latest decline reason (null after approve)
  reviewHistory: ReviewHistoryEntry[];    // every prior decline
  /**
   * When this task becomes eligible for the executor to pick up. null =
   * run asap. Absolute ISO timestamp — relative offsets (`+7d`) are
   * resolved at creation time, never stored as relative.
   */
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Chat — per-goal operator chat. Separate from the action/execution path.
// ---------------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant' | 'tool';

/**
 * A tool call the assistant issued. `status` tracks the confirmation
 * lifecycle for destructive tools:
 *   - `auto`      — ran immediately (read-only tools + create_task)
 *   - `pending`   — awaiting human confirm before running
 *   - `accepted`  — human confirmed; executed
 *   - `declined`  — human declined; not executed
 *   - `errored`   — ran but handler threw
 */
export interface ChatToolCall {
  id: string;              // Anthropic tool_use id
  name: string;            // tool name
  input: Record<string, unknown>;
  status: 'auto' | 'pending' | 'accepted' | 'declined' | 'errored';
  result?: unknown;        // tool output (only when status is auto/accepted/errored)
  error?: string;
}

/**
 * A single row in the conversation. Roles:
 *   - `user`      — human typed message; `content` holds text.
 *   - `assistant` — model turn; `content` holds text, `toolCalls` holds tool_use blocks.
 *   - `tool`      — server-side tool result; `toolUseId` + `toolResult` set.
 *
 * For SQLite compactness we fold the tool_result row's payload into
 * `toolResult` rather than inventing a separate table.
 */
export interface ChatMessage {
  id: string;
  goalId: string;
  role: ChatRole;
  content: string;
  toolCalls: ChatToolCall[];
  toolUseId: string | null;
  toolResult: unknown;
  model: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Knowledge — general-purpose knowledge base entries agents read at runtime
// ---------------------------------------------------------------------------

export type KnowledgeContentType = 'markdown' | 'json' | 'text';

export interface Knowledge {
  id: string;
  slug: string;
  title: string;
  collection: string;
  tags: string[];
  content: string;
  contentType: KnowledgeContentType;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// MCP connection (registered MCP servers agents can use)
// ---------------------------------------------------------------------------

export interface McpConnection {
  id: string;
  name: string;
  url: string;
  config: Record<string, unknown>;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * OAuth state persisted on `mcp_connections.config.oauth` for remote HTTP MCPs
 * that require per-user auth. Never written to `.mcp.json` — only the derived
 * bearer token lands there (via `headers.Authorization`). Refresh tokens stay
 * in the DB and the refresher re-mints headers on rotation.
 */
export interface McpOAuthState {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  scope: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;               // usually "Bearer"
  accessTokenExpiresAt: string;    // ISO
  resource: string;                // the MCP URL, per RFC 8707
  lastRefreshError: string | null; // surfaced to UI as "re-auth required" badge
}

// ---------------------------------------------------------------------------
// Catalog — Browse-and-install entries proxied from Smithery + skills.sh.
// Registry data is untrusted; treat every string field as plain text.
// ---------------------------------------------------------------------------

export interface CatalogMcp {
  qualifiedName: string;
  displayName: string;
  description: string;
  iconUrl: string | null;
  homepage: string | null;
  verified: boolean;
  useCount: number;
  remote: boolean;
  installed: boolean;
}

/**
 * Config schema is JSON Schema flavored — Smithery gives us a rough subset of
 * `{ type: "object", properties: { KEY: { type: "string", format?: "password" } } }`.
 * The secret-input modal renders each property as one form row. Unsupported
 * shapes fall back to a raw JSON textarea.
 */
export interface CatalogMcpConnection {
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  deploymentUrl?: string;
  configSchema: Record<string, unknown>;
}

export interface CatalogMcpDetail extends CatalogMcp {
  connections: CatalogMcpConnection[];
}

export interface CatalogMcpList {
  entries: CatalogMcp[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
}

export interface CatalogSkill {
  owner: string;
  repo: string;
  slug: string;
  displayName: string;
  description: string;
  iconUrl: string | null;
  installCount: number | null;
  githubStars: number | null;
  installed: boolean;
}

export interface CatalogSkillList {
  entries: CatalogSkill[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Skill — SKILL.md files installed under .claude/skills/<slug>/
// ---------------------------------------------------------------------------

export interface Skill {
  slug: string;
  name: string;
  description: string;
  body: string;
  updatedAt: string;
}
