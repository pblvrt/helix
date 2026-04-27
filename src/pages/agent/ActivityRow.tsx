import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ActivityItem } from './agentUtils';

/** Extract full text from a thinking/text entry */
function getFullText(item: ActivityItem): string | null {
  const data = item.raw.data;
  // Plain text entry
  if (item.raw.type === 'text') return String(data.content || '');
  // Assistant message with text block
  if (data.type === 'assistant' && data.message) {
    const content = (data.message as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const texts = (content as Array<Record<string, unknown>>)
        .filter(b => (b.type === 'text' && b.text) || (b.type === 'thinking' && b.thinking))
        .map(b => String(b.text || b.thinking));
      if (texts.length > 0) return texts.join('\n\n');
    }
  }
  return null;
}

export default function ActivityRow({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(item.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const Icon = item.icon;

  const kindStyles: Record<string, string> = {
    'error': 'bg-red-50 border border-red-200',
    'status': 'bg-surface-2',
    'navigate': 'bg-white border border-edge',
    'extract': 'bg-white border border-edge',
    'thinking': 'bg-transparent',
    'skip': 'bg-transparent',
    'tool': 'bg-transparent',
  };

  // Collapse trivial entries
  if (item.kind === 'tool' && !expanded) {
    return (
      <button onClick={() => setExpanded(true)} className="w-full flex items-center gap-2 px-3 py-1 text-left text-[11px] text-muted hover:text-secondary transition-colors rounded-lg hover:bg-surface-2">
        <span className="text-[10px] font-mono text-gray-300 w-[52px] shrink-0">{time}</span>
        <Icon size={11} className="text-gray-300 shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    );
  }

  // For thinking/text entries, show full text (not just label)
  const fullText = (item.kind === 'thinking' || item.kind === 'skip') ? getFullText(item) : null;
  const isLong = fullText && fullText.length > 200;

  return (
    <div className={`rounded-lg px-3 py-2 transition-all ${kindStyles[item.kind] || ''}`}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-start gap-2.5 text-left">
        <span className="text-[10px] font-mono text-muted w-[52px] shrink-0 mt-0.5">{time}</span>
        <Icon size={13} className={`shrink-0 mt-0.5 ${item.color}`} />
        <div className="flex-1 min-w-0">
          {fullText ? (
            <pre className={`text-[11px] whitespace-pre-wrap break-words font-sans ${item.kind === 'thinking' ? 'text-secondary' : 'text-muted'} ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
              {fullText}
            </pre>
          ) : (
            <>
              <span className={`text-[12px] font-medium ${item.kind === 'error' ? 'text-red-600' : 'text-primary'}`}>
                {item.label}
              </span>
              {item.detail && (
                <span className="text-[11px] text-muted ml-2">{item.detail}</span>
              )}
            </>
          )}
        </div>
        {expanded ? <ChevronDown size={12} className="text-muted shrink-0 mt-0.5" /> : <ChevronRight size={12} className="text-gray-300 shrink-0 mt-0.5" />}
      </button>

      {expanded && !fullText && (
        <pre className="mt-2 ml-[68px] text-[10px] text-muted bg-[#1a1a2e] text-gray-400 rounded-lg p-3 overflow-x-auto max-h-[300px] overflow-y-auto font-mono whitespace-pre-wrap break-words">
          {JSON.stringify(item.raw.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
