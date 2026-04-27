import {
  Zap, Bot, Terminal, Globe, MousePointer, FileText, ArrowRight,
  CheckCircle, AlertTriangle, Eye, BookOpen, GitBranch,
} from 'lucide-react';
import type { LogEntry } from '../../api/client';

// ---------------------------------------------------------------------------
// Constants — fallback icons/labels for well-known commands.
// Every command you add to .claude/commands/ works automatically;
// these maps just let the UI show a nicer icon/label when it recognizes one.
// ---------------------------------------------------------------------------

export const COMMAND_ICONS: Record<string, React.ElementType> = {};

export const COMMAND_LABELS: Record<string, string> = {};

export const COMMAND_DESCRIPTIONS: Record<string, string> = {};

export const CONFIG_FILE_ICONS: Record<string, React.ElementType> = {
  'architecture.md': GitBranch,
  'memory.md': BookOpen,
};

export const CRON_PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 2h', cron: '0 */2 * * *' },
  { label: 'Every 4h biz', cron: '0 9,13,17 * * 1-5' },
  { label: '9am weekdays', cron: '0 9 * * 1-5' },
  { label: '9am + 3pm', cron: '0 9,15 * * 1-5' },
];

export const STATUS_DOT_COLORS: Record<string, string> = {
  done: 'bg-emerald-500',
  error: 'bg-red-500',
  running: 'bg-yellow-400 animate-pulse',
  crashed: 'bg-gray-400',
  stopped: 'bg-gray-400',
  starting: 'bg-yellow-400 animate-pulse',
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ActiveRunInfo {
  id: string;
  command: string;
  status: string;
  pid?: number;
  started_at: string;
}

export interface ActivityItem {
  id: string;
  timestamp: number;
  kind: 'status' | 'navigate' | 'extract' | 'thinking' | 'tool' | 'error' | 'skip';
  label: string;
  detail?: string;
  icon: React.ElementType;
  color: string;
  raw: LogEntry;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function cronToHuman(expr: string): string {
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const isEveryDay = dayOfMonth === '*' && month === '*' && dayOfWeek === '*';
  const isWeekdays = dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5';
  const dayLabel = isWeekdays ? 'Weekdays' : isEveryDay ? 'Daily' : '';
  if (minute.startsWith('*/') && hour === '*' && isEveryDay) return `Every ${minute.slice(2)}min`;
  if (minute.startsWith('*/') && hour.includes('-') && isWeekdays) {
    const [h1, h2] = hour.split('-');
    return `Every ${minute.slice(2)}min, ${h1}–${h2} weekdays`;
  }
  if (minute === '0' && hour === '*' && isEveryDay) return 'Every hour';
  if (minute === '0' && hour.startsWith('*/') && isEveryDay) return `Every ${hour.slice(2)}h`;
  if (minute === '0' && /^[\d,]+$/.test(hour) && (isEveryDay || isWeekdays)) {
    const times = hour.split(',').map((h) => `${h.padStart(2, '0')}:00`).join(', ');
    return dayLabel ? `${dayLabel} ${times}` : `At ${times}`;
  }
  return expr;
}

export function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function formatElapsed(startedAt: string): string {
  const totalSec = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Log parsing — turns a stream-json log entry into one display row.
// ---------------------------------------------------------------------------

export function parseLogEntry(entry: LogEntry, index: number): ActivityItem | null {
  const id = `${entry.timestamp}-${index}`;
  const ts = entry.timestamp;

  if (entry.type === 'status') {
    const status = entry.data.status as string;
    if (status === 'running') {
      return {
        id, timestamp: ts, kind: 'status',
        label: 'Agent started',
        detail: entry.data.command ? `Running ${entry.data.command}` : undefined,
        icon: Zap, color: 'text-emerald-500', raw: entry,
      };
    }
    if (status === 'done') {
      return {
        id, timestamp: ts, kind: 'status',
        label: 'Agent finished',
        detail: entry.data.exitCode !== undefined ? `Exit code ${entry.data.exitCode}` : undefined,
        icon: CheckCircle, color: 'text-emerald-500', raw: entry,
      };
    }
    if (status === 'error' || status === 'stopped') {
      return {
        id, timestamp: ts, kind: 'status',
        label: status === 'error' ? 'Agent error' : 'Agent stopped',
        icon: AlertTriangle, color: 'text-red-400', raw: entry,
      };
    }
    return null;
  }

  if (entry.type === 'error') {
    return {
      id, timestamp: ts, kind: 'error',
      label: 'Error',
      detail: String(entry.data.content || '').slice(0, 200),
      icon: AlertTriangle, color: 'text-red-400', raw: entry,
    };
  }

  if (entry.type === 'text') {
    const content = String(entry.data.content || '');
    if (!content.trim()) return null;
    return {
      id, timestamp: ts, kind: 'thinking',
      label: content.slice(0, 150),
      icon: Bot, color: 'text-gray-400', raw: entry,
    };
  }

  // Claude stream-json assistant message
  const msg = entry.data;
  if (msg.type === 'assistant' && msg.message) {
    const content = (msg.message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return null;

    const items: ActivityItem[] = [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'thinking' && block.thinking) {
        const text = String(block.thinking).trim();
        if (text) {
          items.push({ id: `${id}-think`, timestamp: ts, kind: 'thinking', label: text.slice(0, 300), icon: Bot, color: 'text-purple-400', raw: entry });
        }
      }
      if (block.type === 'text' && block.text) {
        const text = String(block.text).trim();
        if (!text) continue;
        items.push({ id: `${id}-t`, timestamp: ts, kind: 'thinking', label: text.slice(0, 300), icon: Bot, color: 'text-blue-400', raw: entry });
      }
      if (block.type === 'tool_use') {
        const name = String(block.name || '');
        const input = block.input as Record<string, unknown> | undefined;
        const item = parseToolUse(name, input, id, ts, entry);
        if (item) items.push(item);
      }
    }
    const priority = ['navigate', 'extract', 'error', 'tool', 'skip', 'thinking'];
    items.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
    return items[0] || null;
  }

  if (msg.type === 'result') {
    const r = msg as Record<string, unknown>;
    return {
      id, timestamp: ts, kind: 'status',
      label: `Completed — ${r.num_turns || '?'} turns, $${r.cost_usd || '?'}`,
      icon: CheckCircle, color: 'text-emerald-500', raw: entry,
    };
  }

  return null;
}

function parseToolUse(
  name: string,
  input: Record<string, unknown> | undefined,
  id: string,
  ts: number,
  raw: LogEntry,
): ActivityItem | null {
  if (name === 'mcp__chrome-devtools__navigate_page') {
    const url = String(input?.url || '');
    return { id: `${id}-nav`, timestamp: ts, kind: 'navigate', label: 'Navigating', detail: url.slice(0, 80), icon: Globe, color: 'text-blue-400', raw };
  }

  if (name === 'mcp__chrome-devtools__evaluate_script') {
    return { id: `${id}-eval`, timestamp: ts, kind: 'tool', label: 'Running script', icon: Terminal, color: 'text-gray-400', raw };
  }

  if (name === 'mcp__chrome-devtools__click') {
    return { id: `${id}-click`, timestamp: ts, kind: 'tool', label: 'Clicking element', icon: MousePointer, color: 'text-gray-400', raw };
  }

  if (name === 'Bash') {
    const desc = String(input?.description || '');
    const cmd = String(input?.command || '');
    return { id: `${id}-bash`, timestamp: ts, kind: 'tool', label: desc || cmd.slice(0, 80), icon: Terminal, color: 'text-gray-400', raw };
  }

  if (name === 'Read') {
    const fp = String(input?.file_path || '');
    const filename = fp.split('/').pop() || fp;
    return { id: `${id}-read`, timestamp: ts, kind: 'tool', label: `Reading ${filename}`, icon: FileText, color: 'text-gray-400', raw };
  }

  if (name === 'mcp__chrome-devtools__take_snapshot' || name === 'mcp__chrome-devtools__take_screenshot') {
    return { id: `${id}-snap`, timestamp: ts, kind: 'tool', label: 'Taking snapshot', icon: Eye, color: 'text-gray-400', raw };
  }

  return {
    id: `${id}-tool`, timestamp: ts, kind: 'tool',
    label: name.replace(/^mcp__[^_]+__/, ''),
    icon: Terminal, color: 'text-gray-400', raw,
  };
}

export { ArrowRight };
