/**
 * Job Manager — manages action execution with DB-persisted queue.
 *
 * Flow: submit() → creates action (queued) → processQueue() → running → done/error
 * Queue survives restarts. One action at a time.
 * Actions are killed after JOB_TIMEOUT_MS (1 hour) to prevent queue blocking.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import type Database from 'better-sqlite3';
import type { PathConfig } from '../../core/paths.js';
import type { LogEntry, Action } from '../../core/types.js';
import { actionToCamel } from '../../core/transforms.js';
import type { createActionsRepository } from './actions.model.js';
import type { createGoalsRepository } from '../goals/goals.model.js';

const JOB_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

export interface JobManagerEvents {
  'job:started': (actionId: string) => void;
  'job:entry': (actionId: string, entry: LogEntry) => void;
  'job:done': (actionId: string, exitCode: number | null) => void;
  'job:error': (actionId: string, error: Error) => void;
}

export function createJobManager(opts: {
  db: Database.Database;
  paths: PathConfig;
  actionsRepo: ReturnType<typeof createActionsRepository>;
  goalsRepo: ReturnType<typeof createGoalsRepository>;
}) {
  const { db, paths, actionsRepo, goalsRepo } = opts;
  const emitter = new EventEmitter();
  let activeProcess: ChildProcess | null = null;
  let activeActionId: string | null = null;
  let activeTimeout: ReturnType<typeof setTimeout> | null = null;
  let activeLogFd: number | null = null;

  fs.mkdirSync(paths.runsDir, { recursive: true });

  let pendingArgs: Map<string, string> = new Map();
  let pendingAgentOverrides: Map<string, string> = new Map();
  /**
   * Optional per-action scoped `.mcp.json` path. When set, the action's Claude
   * process is invoked with `--mcp-config <path>` so it only sees the MCP
   * servers the goal explicitly linked, not the global `.mcp.json`. Cleaned
   * up on action completion.
   */
  let pendingMcpConfigs: Map<string, string> = new Map();

  /** Create a new action and queue it */
  function submit(command: string, opts?: { args?: string; jobId?: string; agent?: string; mcpConfigPath?: string }): string {
    const commands = actionsRepo.getCommandMap();
    const cmd = commands[command];
    if (!cmd) throw new Error(`Unknown command: ${command}`);

    const action = goalsRepo.createAction(opts?.jobId ?? null, { actionType: command });
    goalsRepo.updateAction(action.id, { status: 'queued' } as any);

    if (opts?.args) pendingArgs.set(action.id, opts.args);
    if (opts?.agent) pendingAgentOverrides.set(action.id, opts.agent);
    if (opts?.mcpConfigPath) pendingMcpConfigs.set(action.id, opts.mcpConfigPath);

    processQueue();
    return action.id;
  }

  /** Queue an existing action (already in the DB) for execution */
  function enqueue(actionId: string, opts?: { args?: string; agent?: string; mcpConfigPath?: string }): void {
    const row = db.prepare('SELECT action_type FROM actions WHERE id = ?').get(actionId) as { action_type: string } | undefined;
    if (!row) throw new Error(`Action ${actionId} not found`);

    const commands = actionsRepo.getCommandMap();
    if (!commands[row.action_type]) throw new Error(`Unknown command: ${row.action_type}`);

    db.prepare("UPDATE actions SET status = 'queued' WHERE id = ?").run(actionId);
    if (opts?.args) pendingArgs.set(actionId, opts.args);
    if (opts?.agent) pendingAgentOverrides.set(actionId, opts.agent);
    if (opts?.mcpConfigPath) pendingMcpConfigs.set(actionId, opts.mcpConfigPath);

    processQueue();
  }

  function processQueue(): void {
    if (activeProcess) return;

    // Check DB for stale running actions
    const active = db.prepare("SELECT * FROM actions WHERE status = 'running' AND pid IS NOT NULL LIMIT 1").get() as Action | undefined;
    if (active) return;

    // Get next queued action
    const next = db.prepare("SELECT * FROM actions WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get();
    if (!next) return;

    startAction(next as Record<string, unknown>);
  }

  function cleanupAction(actionId: string, status: string, exitCode: number | null, error?: string): void {
    if (activeTimeout) { clearTimeout(activeTimeout); activeTimeout = null; }

    if (activeLogFd !== null) {
      try { fs.closeSync(activeLogFd); } catch {}
      activeLogFd = null;
    }

    if (activeProcess) {
      try { activeProcess.kill('SIGKILL'); } catch {}
      activeProcess = null;
    }

    // Remove any per-action scoped `.mcp.json` we wrote before starting.
    // Tokens in it would be stale anyway; we regenerate per run.
    const scopedMcp = `${paths.runsDir}/${actionId}.mcp.json`;
    if (fs.existsSync(scopedMcp)) { try { fs.unlinkSync(scopedMcp); } catch {} }

    activeActionId = null;

    const sets = ["status = ?", "finished_at = datetime('now')"];
    const values: unknown[] = [status];
    if (exitCode !== null) { sets.push('exit_code = ?'); values.push(exitCode); }
    if (error) { sets.push('error = ?'); values.push(error); }
    if (status === 'done' || status === 'error' || status === 'stopped') {
      sets.push("completed_at = datetime('now')");
    }
    values.push(actionId);
    db.prepare(`UPDATE actions SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    if (status === 'stopped' || status === 'error') {
      emitter.emit('job:done', actionId, exitCode ?? 1);
    }

    setImmediate(() => processQueue());
  }

  function startAction(row: Record<string, unknown>): void {
    const actionId = String(row.id);
    const actionType = row.action_type as string;

    const commands = actionsRepo.getCommandMap();
    const cmd = commands[actionType];
    if (!cmd) {
      cleanupAction(actionId, 'error', null, `Unknown command: ${actionType}`);
      return;
    }

    const logPath = `${paths.runsDir}/${actionId}.jsonl`;
    // Clear stale log from a previous action with the same ID (e.g. after goal delete + recreate)
    if (fs.existsSync(logPath)) { try { fs.unlinkSync(logPath); } catch {} }
    activeLogFd = fs.openSync(logPath, 'a');
    activeActionId = actionId;

    const args = pendingArgs.get(actionId);
    pendingArgs.delete(actionId);
    const agentOverride = pendingAgentOverrides.get(actionId);
    pendingAgentOverrides.delete(actionId);
    const mcpConfigPath = pendingMcpConfigs.get(actionId);
    pendingMcpConfigs.delete(actionId);
    const prompt = [cmd.prompt, args].filter(Boolean).join('\n\n---\n\n');

    // No --max-turns: the 1-hour JOB_TIMEOUT_MS below and the skill-level halts
    // (CAPTCHA, weekly limit, daily quota, empty queue) are the real stops. A turn
    // cap just strands healthy long runs half-done.
    //
    // ORDERING MATTERS: `--mcp-config <configs...>` is a commander-variadic
    // arg that greedily consumes tokens until the next --flag. If we put it
    // right before the prompt, the prompt itself gets swallowed as a second
    // "config file path" and claude tries to fs.open(prompt) → ENAMETOOLONG.
    // Keep --mcp-config FIRST so --output-format terminates the variadic.
    const cliArgs: string[] = ['-p', '--verbose', '--dangerously-skip-permissions'];
    // Scoped MCP config — when a goal linked specific MCP servers, point the
    // CLI at a per-action file that only contains those servers. Without this
    // flag, Claude Code reads the global `.mcp.json` (all servers visible).
    if (mcpConfigPath && fs.existsSync(mcpConfigPath)) {
      cliArgs.push('--mcp-config', mcpConfigPath);
    }
    cliArgs.push('--output-format', 'stream-json', '--model', 'claude-opus-4-7');
    const effectiveAgent = agentOverride || cmd.agent;
    if (effectiveAgent) cliArgs.push('--agent', effectiveAgent);
    cliArgs.push(prompt);
    const proc = spawn('claude', cliArgs, { cwd: paths.projectDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });

    activeProcess = proc;

    db.prepare("UPDATE actions SET status = 'running', pid = ?, started_at = datetime('now') WHERE id = ?")
      .run(proc.pid, actionId);

    const appendLog = (type: string, data: unknown) => {
      if (activeLogFd === null) return;
      const entry: LogEntry = { type: type as LogEntry['type'], data: data as Record<string, unknown>, timestamp: Date.now() };
      try { fs.appendFileSync(activeLogFd, JSON.stringify(entry) + '\n'); } catch {}
      emitter.emit('job:entry', actionId, entry);
    };

    emitter.emit('job:started', actionId);
    appendLog('status', { status: 'running', actionId, pid: proc.pid, command: actionType });

    activeTimeout = setTimeout(() => {
      console.log(`[job-manager] Action ${actionId} (${actionType}) timed out after 1 hour — killing`);
      appendLog('status', { status: 'timeout', message: 'Action killed after 1 hour timeout' });
      cleanupAction(actionId, 'error', null, 'Timed out after 1 hour');
    }, JOB_TIMEOUT_MS);

    let buffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { appendLog('message', JSON.parse(line)); }
        catch { appendLog('text', { content: line }); }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      appendLog('error', { content: chunk.toString() });
    });

    proc.on('close', (code) => {
      if (!activeActionId || activeActionId !== actionId) return;

      if (buffer.trim()) {
        try { appendLog('message', JSON.parse(buffer)); }
        catch { appendLog('text', { content: buffer }); }
      }
      appendLog('status', { status: 'done', exitCode: code });

      const status = code === 0 ? 'done' : 'error';
      emitter.emit('job:done', actionId, code);
      cleanupAction(actionId, status, code);
    });

    proc.on('error', (err) => {
      if (!activeActionId || activeActionId !== actionId) return;

      appendLog('error', { content: err.message });
      appendLog('status', { status: 'error', error: err.message });
      emitter.emit('job:error', actionId, err);
      cleanupAction(actionId, 'error', null, err.message);
    });
  }

  function stop(actionId: string): { ok: true; message: string } {
    const row = db.prepare('SELECT * FROM actions WHERE id = ?').get(actionId) as Record<string, unknown> | undefined;
    if (!row) return { ok: true, message: 'Action not found' };

    if (row.status === 'queued') {
      db.prepare("UPDATE actions SET status = 'cancelled', finished_at = datetime('now'), completed_at = datetime('now') WHERE id = ?").run(actionId);
      return { ok: true, message: 'Queued action cancelled' };
    }

    if (row.status === 'running') {
      // If this is the active action in memory, clean up properly
      if (activeActionId === String(actionId)) {
        cleanupAction(String(actionId), 'stopped', null);
      } else {
        // Not tracked in memory (e.g. stale) — kill by PID
        if (row.pid) {
          try { process.kill(row.pid as number, 'SIGKILL'); } catch {}
        }
        db.prepare("UPDATE actions SET status = 'stopped', finished_at = datetime('now'), completed_at = datetime('now') WHERE id = ?").run(actionId);
      }
      return { ok: true, message: 'Running action stopped' };
    }

    return { ok: true, message: 'Action not running' };
  }

  function stopActive(): { ok: true; message: string } {
    if (activeActionId) return stop(activeActionId);
    const active = db.prepare("SELECT id FROM actions WHERE status = 'running' AND pid IS NOT NULL LIMIT 1").get() as { id: number } | undefined;
    if (active) return stop(String(active.id));
    return { ok: true, message: 'No active action' };
  }

  function getQueue(): Action[] {
    const rows = db.prepare("SELECT * FROM actions WHERE status = 'queued' ORDER BY created_at ASC").all() as Record<string, unknown>[];
    return rows.map(r => actionToCamel(r));
  }

  return {
    submit,
    enqueue,
    stop,
    stopActive,
    getQueue,
    processQueue,
    emitter,
  };
}
