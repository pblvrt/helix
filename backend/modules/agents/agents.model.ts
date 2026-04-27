import fs from 'fs';
import path from 'path';
import type { PathConfig } from '../../core/paths.js';

export interface AgentDescriptor {
  name: string;
  description: string;
  model?: string;
}

/**
 * Parses YAML frontmatter from a markdown file. Supports the subset actually
 * used in `.claude/agents/*.md`: key-value pairs + simple list entries. This
 * avoids pulling in a yaml dependency for the 3-5 fields we care about.
 */
function parseAgentFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const body = m[1];
  const out: Record<string, string> = {};
  // Match `key: value` at line start, ignoring list items (tools array etc.)
  for (const line of body.split('\n')) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.+?)\s*$/);
    if (!kv) continue;
    const [, key, value] = kv;
    // skip if the value is empty (key starts a multi-line list like `tools:`)
    if (!value) continue;
    // Strip surrounding quotes
    out[key] = value.replace(/^["']|["']$/g, '');
  }
  return out;
}

export function createAgentsRepository(paths: PathConfig) {
  const agentsDir = path.join(path.dirname(paths.commandsDir), 'agents');

  return {
    list(): AgentDescriptor[] {
      if (!fs.existsSync(agentsDir)) return [];
      const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      const agents: AgentDescriptor[] = [];
      for (const file of files) {
        const full = path.join(agentsDir, file);
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const fm = parseAgentFrontmatter(content);
          const name = fm.name || file.replace(/\.md$/, '');
          agents.push({
            name,
            description: fm.description || '',
            model: fm.model || undefined,
          });
        } catch {
          // Skip unreadable files rather than failing the whole list
        }
      }
      agents.sort((a, b) => a.name.localeCompare(b.name));
      return agents;
    },

    get(name: string): AgentDescriptor | null {
      return this.list().find(a => a.name === name) || null;
    },
  };
}
