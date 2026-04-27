import type Database from 'better-sqlite3';

type Row = Record<string, unknown>;

export interface McpConnection {
  id: string;
  name: string;
  url: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function rowToMcp(row: Row): McpConnection {
  return {
    id: String(row.id),
    name: row.name as string,
    url: (row.url as string) || '',
    config: JSON.parse((row.config as string) || '{}'),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createMcpRepository(db: Database.Database) {
  return {
    list(): McpConnection[] {
      const rows = db.prepare('SELECT * FROM mcp_connections ORDER BY id ASC').all() as Row[];
      return rows.map(rowToMcp);
    },

    get(id: string): McpConnection | null {
      const row = db.prepare('SELECT * FROM mcp_connections WHERE id = ?').get(id) as Row | undefined;
      return row ? rowToMcp(row) : null;
    },

    create(data: { name: string; url?: string; config?: Record<string, unknown> }): McpConnection {
      const result = db.prepare(
        'INSERT INTO mcp_connections (name, url, config) VALUES (?, ?, ?)'
      ).run(data.name, data.url || '', JSON.stringify(data.config || {}));
      return rowToMcp(db.prepare('SELECT * FROM mcp_connections WHERE id = ?').get(result.lastInsertRowid) as Row);
    },

    update(id: string, data: Partial<{ name: string; url: string; config: Record<string, unknown> }>): McpConnection | null {
      const existing = db.prepare('SELECT * FROM mcp_connections WHERE id = ?').get(id) as Row | undefined;
      if (!existing) return null;
      const sets: string[] = [];
      const values: unknown[] = [];
      if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
      if (data.url !== undefined) { sets.push('url = ?'); values.push(data.url); }
      if (data.config !== undefined) { sets.push('config = ?'); values.push(JSON.stringify(data.config)); }
      if (sets.length === 0) return rowToMcp(existing);
      sets.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`UPDATE mcp_connections SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return rowToMcp(db.prepare('SELECT * FROM mcp_connections WHERE id = ?').get(id) as Row);
    },

    delete(id: string): { ok: true } {
      db.prepare('DELETE FROM mcp_connections WHERE id = ?').run(id);
      return { ok: true };
    },

    // -------------------------------------------------------------------------
    // Per-goal enablement (join table)
    // -------------------------------------------------------------------------

    /** Return IDs of MCP connections enabled for a goal */
    listForGoal(goalId: string): string[] {
      const rows = db.prepare('SELECT mcp_id FROM goal_mcp_connections WHERE goal_id = ?').all(goalId) as { mcp_id: number }[];
      return rows.map(r => String(r.mcp_id));
    },

    /** Replace the full enabled-MCP set for a goal */
    setForGoal(goalId: string, mcpIds: string[]): void {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM goal_mcp_connections WHERE goal_id = ?').run(goalId);
        const insert = db.prepare('INSERT INTO goal_mcp_connections (goal_id, mcp_id) VALUES (?, ?)');
        for (const id of mcpIds) insert.run(goalId, id);
      });
      tx();
    },
  };
}
