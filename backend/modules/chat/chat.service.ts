/**
 * Chat service — spawns the `claude` CLI per turn.
 *
 * Free: runs on Pablo's Claude Max subscription, no API tokens billed.
 * One turn = one `claude -p` subprocess invocation. The subprocess reads
 * the prompt (system + history + new user message), emits text (streamed
 * back to the browser as SSE), and may end with a single `PROPOSE_ACTION`
 * block. The service parses that block:
 *
 *   - auto tools (read-only + create_task)  → run handler server-side,
 *     append the result to history, spawn the next turn automatically.
 *   - destructive tools (update, approve, decline, delete, context, planner)
 *     → pause and emit a `tool_use_pending` event. The UI shows a confirm
 *     card; Pablo's click posts to /confirm, which runs the handler and
 *     spawns the next turn.
 *
 * The chat subprocess runs OUTSIDE the job-manager queue. Chat must stay
 * responsive even when a plan/execute action is running.
 */

import { spawn } from 'child_process';
import type Database from 'better-sqlite3';
import type { PathConfig } from '../../core/paths.js';
import type { ChatMessage, ChatToolCall } from '../../core/types.js';
import type { createChatRepository } from './chat.model.js';
import { findTool, type ChatToolDeps } from './chat-tools.js';
import type { createTasksRepository } from '../tasks/tasks.model.js';
import type { createGoalsRepository } from '../goals/goals.model.js';
import type { createKnowledgeRepository } from '../knowledge/knowledge.model.js';
import type { createJobManager } from '../actions/job-manager.js';

export type ChatEvent =
  | { type: 'message_start'; messageId: string }
  | { type: 'text_delta';    delta: string }
  | { type: 'tool_use_auto_start'; toolCall: ChatToolCall }
  | { type: 'tool_use_result';     toolUseId: string; result: unknown; error?: string }
  | { type: 'tool_use_pending';    toolCalls: ChatToolCall[] }
  | { type: 'error'; error: string }
  | { type: 'done' };

export interface ChatServiceDeps {
  db: Database.Database;
  paths: PathConfig;
  chatRepo: ReturnType<typeof createChatRepository>;
  tasksRepo: ReturnType<typeof createTasksRepository>;
  goalsRepo: ReturnType<typeof createGoalsRepository>;
  knowledgeRepo: ReturnType<typeof createKnowledgeRepository>;
  jobManager: ReturnType<typeof createJobManager>;
}

const PROPOSE_START = '===PROPOSE_ACTION===';
const PROPOSE_END   = '===END===';
const MAX_CHAINED_AUTO_TURNS = 8;   // prevent tool-loop runaways

/** Minimum random-ish id that won't collide with Anthropic tool_use ids. */
function newToolUseId(): string {
  return `local_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

export function createChatService(deps: ChatServiceDeps) {
  const { paths, chatRepo, tasksRepo, goalsRepo, knowledgeRepo, jobManager } = deps;

  /**
   * Build the prompt the `chat` agent receives. Layout matches chat.md:
   *   GOAL_CONTEXT → HISTORY → USER
   */
  function buildPrompt(goalId: string, userContent: string): string {
    const goal = goalsRepo.get(goalId);
    if (!goal) return '';

    const contextMd = typeof goal.context === 'object'
      ? (goal.context?.markdown as string | undefined) ?? JSON.stringify(goal.context)
      : String(goal.context ?? '');

    const allTasks = tasksRepo.list({ status: 'all' }).filter(t =>
      (t.payload?.goalContext as Record<string, unknown> | undefined)?.goalId === goalId
    );
    const counts: Record<string, number> = {};
    for (const t of allTasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
    const recent = allTasks.slice(0, 10).map(t => `  #${t.id} [${t.type}] [${t.status}] P${t.priority} — ${t.title}`).join('\n') || '  (empty)';

    const goalCtx = {
      goalId, goalTitle: goal.title, agentType: goal.agentType,
      status: goal.status, counts,
      recentTasks: recent,
      contextMarkdown: contextMd,
    };

    // History: compact the stored messages into a transcript the agent can parse.
    // Tool messages get inlined under the assistant turn that triggered them.
    const history = chatRepo.list(goalId);
    const histLines: string[] = [];
    for (const m of history) {
      if (m.role === 'user') {
        histLines.push(`USER: ${m.content}`);
      } else if (m.role === 'assistant') {
        const parts: string[] = [];
        if (m.content) parts.push(m.content);
        for (const tc of m.toolCalls) {
          parts.push(`[proposed: ${tc.name}(${JSON.stringify(tc.input)}) → ${tc.status}${tc.error ? ` — ${tc.error}` : ''}]`);
        }
        histLines.push(`ASSISTANT: ${parts.join('\n')}`);
      } else if (m.role === 'tool') {
        histLines.push(`TOOL_RESULT (${m.toolUseId}): ${typeof m.toolResult === 'string' ? m.toolResult : JSON.stringify(m.toolResult).slice(0, 2000)}`);
      }
    }

    return [
      '===GOAL_CONTEXT===',
      JSON.stringify(goalCtx, null, 2),
      '===END===',
      '',
      '===HISTORY===',
      histLines.slice(-40).join('\n') || '(empty)',
      '===END===',
      '',
      '===USER===',
      userContent,
      '===END===',
    ].join('\n');
  }

  /**
   * Spawn `claude` and stream its output. Returns a promise that resolves
   * with the final accumulated text when the subprocess exits, and calls
   * `onDelta` with each text chunk as it arrives (for SSE streaming).
   */
  function spawnChatAgent(prompt: string, onDelta: (s: string) => void, signal?: AbortSignal): Promise<{ text: string; exitCode: number | null; error?: string }> {
    return new Promise((resolve) => {
      const cliArgs = [
        '-p',
        '--verbose',
        '--dangerously-skip-permissions',
        '--output-format', 'stream-json',
        '--model', 'claude-sonnet-4-5',
        '--agent', 'chat',
        prompt,
      ];
      const proc = spawn('claude', cliArgs, { cwd: paths.projectDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });

      let accumulated = '';
      let stdoutBuf = '';
      let stderr = '';

      // Abort on signal (user cancels mid-turn).
      if (signal) signal.addEventListener('abort', () => { try { proc.kill('SIGKILL'); } catch {} });

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let json: unknown;
          try { json = JSON.parse(trimmed); } catch { continue; }
          // stream-json format: {type:'assistant', message:{content:[{type:'text',text:'...'}]}}
          const obj = json as { type?: string; message?: { content?: Array<{ type: string; text?: string }> } };
          if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
            for (const block of obj.message!.content!) {
              if (block.type === 'text' && block.text) {
                accumulated += block.text;
                onDelta(block.text);
              }
            }
          }
        }
      });

      proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });

      proc.on('close', (code) => {
        resolve({ text: accumulated, exitCode: code, error: code !== 0 ? (stderr.trim().split('\n').slice(-3).join(' | ') || `exit ${code}`) : undefined });
      });
      proc.on('error', (err) => {
        resolve({ text: accumulated, exitCode: null, error: err.message });
      });
    });
  }

  /**
   * Parse the last `===PROPOSE_ACTION===...===END===` block from the agent's
   * output. Returns null if no block or malformed.
   */
  function parseProposal(text: string): { tool: string; args: Record<string, unknown> } | null {
    const startIdx = text.lastIndexOf(PROPOSE_START);
    if (startIdx < 0) return null;
    const afterStart = text.slice(startIdx + PROPOSE_START.length);
    const endIdx = afterStart.indexOf(PROPOSE_END);
    if (endIdx < 0) return null;
    const body = afterStart.slice(0, endIdx).trim();
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.tool !== 'string') return null;
      return { tool: parsed.tool, args: (parsed.args as Record<string, unknown>) ?? {} };
    } catch { return null; }
  }

  /** Strip the PROPOSE_ACTION block from the agent's text before showing to the user. */
  function stripProposal(text: string): string {
    const startIdx = text.lastIndexOf(PROPOSE_START);
    if (startIdx < 0) return text;
    return text.slice(0, startIdx).trimEnd();
  }

  function toolDepsFor(goalId: string): ChatToolDeps {
    return { goalId, tasksRepo, goalsRepo, knowledgeRepo, jobManager };
  }

  /**
   * One turn of the chat loop. Used both for user-sent messages and for
   * continuations after a tool result. Returns events to stream.
   */
  async function* runTurn(goalId: string, userContent: string | null, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    // If userContent is provided, that's a fresh user message (already stored by caller).
    // Otherwise we're continuing — the latest message in history is the tool result
    // that triggered this turn; we need to give the agent something to react to.
    const effectiveUser = userContent ?? '(continue based on the tool result above)';

    for (let chainedTurn = 0; chainedTurn < MAX_CHAINED_AUTO_TURNS; chainedTurn++) {
      const prompt = buildPrompt(goalId, effectiveUser);

      // Stream the subprocess output; accumulate text as deltas arrive.
      const deltas: string[] = [];
      const onDelta = (s: string) => { deltas.push(s); };
      const result = await spawnChatAgent(prompt, onDelta, signal);

      // Flush any deltas that arrived. We haven't yielded them yet — do it now.
      for (const d of deltas) {
        // Strip proposal block from each chunk conservatively — simpler: only strip at final.
        // Emit raw; UI will render the final stripped text from the stored message.
        yield { type: 'text_delta', delta: d };
      }

      if (result.error && !result.text.trim()) {
        const errored = chatRepo.append(goalId, { role: 'assistant', content: `[chat agent error: ${result.error}]`, model: 'claude-sonnet-4-5' });
        yield { type: 'message_start', messageId: errored.id };
        yield { type: 'error', error: result.error };
        yield { type: 'done' };
        return;
      }

      const proposal = parseProposal(result.text);
      const visibleText = stripProposal(result.text);

      // Persist the assistant turn. If proposal exists we attach it as a toolCall.
      const toolCalls: ChatToolCall[] = [];
      if (proposal) {
        const tool = findTool(proposal.tool);
        const toolUseId = newToolUseId();
        if (!tool) {
          toolCalls.push({ id: toolUseId, name: proposal.tool, input: proposal.args, status: 'errored', error: `unknown tool: ${proposal.tool}` });
        } else if (tool.requiresConfirm) {
          toolCalls.push({ id: toolUseId, name: proposal.tool, input: proposal.args, status: 'pending' });
        } else {
          toolCalls.push({ id: toolUseId, name: proposal.tool, input: proposal.args, status: 'auto' });
        }
      }

      const saved = chatRepo.append(goalId, {
        role: 'assistant',
        content: visibleText,
        toolCalls,
        model: 'claude-sonnet-4-5',
      });
      yield { type: 'message_start', messageId: saved.id };

      if (!proposal) {
        // No action — turn ends here.
        yield { type: 'done' };
        return;
      }

      const tc = toolCalls[0];
      if (tc.status === 'errored') {
        chatRepo.append(goalId, { role: 'tool', toolUseId: tc.id, toolResult: { error: tc.error } });
        yield { type: 'tool_use_result', toolUseId: tc.id, result: null, error: tc.error };
        // Keep looping so the agent can recover.
      } else if (tc.status === 'auto') {
        // Run the handler server-side.
        yield { type: 'tool_use_auto_start', toolCall: tc };
        const tool = findTool(tc.name)!;
        try {
          const runResult = await tool.handle(toolDepsFor(goalId), tc.input);
          const updated: ChatToolCall = { ...tc, status: 'auto', result: runResult };
          chatRepo.updateToolCalls(saved.id, [updated]);
          chatRepo.append(goalId, { role: 'tool', toolUseId: tc.id, toolResult: runResult });
          yield { type: 'tool_use_result', toolUseId: tc.id, result: runResult };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const updated: ChatToolCall = { ...tc, status: 'errored', error: msg };
          chatRepo.updateToolCalls(saved.id, [updated]);
          chatRepo.append(goalId, { role: 'tool', toolUseId: tc.id, toolResult: { error: msg } });
          yield { type: 'tool_use_result', toolUseId: tc.id, result: null, error: msg };
        }
      } else if (tc.status === 'pending') {
        // Destructive — pause, wait for user confirm.
        yield { type: 'tool_use_pending', toolCalls: [tc] };
        yield { type: 'done' };
        return;
      }

      // Loop with the tool result fed implicitly via history.
    }

    yield { type: 'error', error: `exceeded ${MAX_CHAINED_AUTO_TURNS} chained turns — possible loop.` };
    yield { type: 'done' };
  }

  /** Entry: user sent a message. */
  async function* sendUserMessage(goalId: string, content: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const trimmed = content.trim();
    if (!trimmed) { yield { type: 'error', error: 'empty message' }; return; }
    chatRepo.append(goalId, { role: 'user', content: trimmed });
    yield* runTurn(goalId, trimmed, signal);
  }

  /**
   * User confirmed / declined a pending tool call. Run the handler (or not)
   * and then re-invoke the chat agent so it can react to the outcome.
   */
  async function* confirmToolUse(
    goalId: string,
    toolUseId: string,
    accept: boolean,
    patch?: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const msg = chatRepo.findByToolUseId(goalId, toolUseId);
    if (!msg) { yield { type: 'error', error: 'tool_use not found' }; yield { type: 'done' }; return; }
    const idx = msg.toolCalls.findIndex(t => t.id === toolUseId);
    if (idx < 0) { yield { type: 'error', error: 'tool_use id mismatch' }; yield { type: 'done' }; return; }
    const tc = msg.toolCalls[idx];
    if (tc.status !== 'pending') { yield { type: 'error', error: `already resolved: ${tc.status}` }; yield { type: 'done' }; return; }

    let result: unknown = null;
    let errored: string | undefined;

    if (accept) {
      const tool = findTool(tc.name);
      if (!tool) { errored = `unknown tool: ${tc.name}`; }
      else {
        try {
          const input = patch ? { ...tc.input, ...patch } : tc.input;
          result = await tool.handle(toolDepsFor(goalId), input);
        } catch (err) {
          errored = err instanceof Error ? err.message : String(err);
        }
      }
    }

    const nextCalls = [...msg.toolCalls];
    nextCalls[idx] = {
      ...tc,
      status: !accept ? 'declined' : errored ? 'errored' : 'accepted',
      result: accept && !errored ? result : undefined,
      error: errored,
    };
    chatRepo.updateToolCalls(msg.id, nextCalls);
    chatRepo.append(goalId, {
      role: 'tool',
      toolUseId,
      toolResult: !accept ? { declined_by_user: true } : errored ? { error: errored } : result,
    });
    yield { type: 'tool_use_result', toolUseId, result: accept ? result : null, error: errored };

    // Continue the conversation so the agent can respond to the outcome.
    yield* runTurn(goalId, null, signal);
  }

  return {
    sendUserMessage,
    confirmToolUse,
    history(goalId: string): ChatMessage[] { return chatRepo.list(goalId); },
    clear(goalId: string) { return chatRepo.clear(goalId); },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
