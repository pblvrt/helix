import type Database from 'better-sqlite3';
import { messageToCamel } from '../../core/transforms.js';
import type { ChatMessage, ChatRole, ChatToolCall } from '../../core/types.js';

export interface AppendMessageInput {
  role: ChatRole;
  content?: string;
  toolCalls?: ChatToolCall[];
  toolUseId?: string | null;
  toolResult?: unknown;
  model?: string | null;
}

export function createChatRepository(db: Database.Database) {
  return {
    /** All messages for a goal, chronological. Keep it small (<500 rows) — older history is the cost we pay on every turn. */
    list(goalId: string): ChatMessage[] {
      const rows = db.prepare(
        `SELECT * FROM goal_messages WHERE goal_id = ? ORDER BY id ASC`
      ).all(goalId) as Record<string, unknown>[];
      return rows.map(messageToCamel);
    },

    /** Most recent N messages (used for quick previews + unread indicator). */
    latest(goalId: string, limit = 50): ChatMessage[] {
      const rows = db.prepare(
        `SELECT * FROM goal_messages WHERE goal_id = ? ORDER BY id DESC LIMIT ?`
      ).all(goalId, Math.max(1, limit)) as Record<string, unknown>[];
      return rows.reverse().map(messageToCamel);
    },

    append(goalId: string, input: AppendMessageInput): ChatMessage {
      const r = db.prepare(
        `INSERT INTO goal_messages (goal_id, role, content, tool_calls, tool_use_id, tool_result, model)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        goalId,
        input.role,
        input.content ?? '',
        JSON.stringify(input.toolCalls ?? []),
        input.toolUseId ?? null,
        input.toolResult !== undefined ? JSON.stringify(input.toolResult) : null,
        input.model ?? null,
      );
      const row = db.prepare(`SELECT * FROM goal_messages WHERE id = ?`).get(r.lastInsertRowid) as Record<string, unknown>;
      return messageToCamel(row);
    },

    /**
     * Update an existing assistant message's toolCalls — used when a
     * pending confirmation resolves so the message reflects the final
     * state (accepted / declined / errored).
     */
    updateToolCalls(messageId: string, toolCalls: ChatToolCall[]): ChatMessage | null {
      db.prepare(
        `UPDATE goal_messages SET tool_calls = ? WHERE id = ?`
      ).run(JSON.stringify(toolCalls), messageId);
      const row = db.prepare(`SELECT * FROM goal_messages WHERE id = ?`).get(messageId) as Record<string, unknown> | undefined;
      return row ? messageToCamel(row) : null;
    },

    /** Find the assistant message whose tool_calls array contains the given tool_use_id. */
    findByToolUseId(goalId: string, toolUseId: string): ChatMessage | null {
      const rows = db.prepare(
        `SELECT * FROM goal_messages WHERE goal_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 20`
      ).all(goalId) as Record<string, unknown>[];
      for (const r of rows) {
        const msg = messageToCamel(r);
        if (msg.toolCalls.some(t => t.id === toolUseId)) return msg;
      }
      return null;
    },

    clear(goalId: string): { ok: true; deleted: number } {
      const r = db.prepare(`DELETE FROM goal_messages WHERE goal_id = ?`).run(goalId);
      return { ok: true, deleted: r.changes };
    },
  };
}
