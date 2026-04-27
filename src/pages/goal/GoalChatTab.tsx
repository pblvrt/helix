import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare, Send, Loader2, Trash2, User, Bot, Wrench, Check, X as XIcon,
  ShieldAlert, AlertTriangle,
} from 'lucide-react';
import {
  fetchChatHistory, clearChatHistory,
  streamChatTurn, streamChatConfirm,
  type ChatMessage, type ChatStreamEvent, type ChatToolCall,
} from '../../api/client';

interface Props {
  goalId: string;
}

/**
 * GoalChatTab — conversational chat panel on a goal. Streams the assistant's
 * turn over SSE, renders tool-use cards inline, and surfaces confirm
 * buttons when the agent proposes a destructive action.
 */
export default function GoalChatTab({ goalId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try { setMessages(await fetchChatHistory(goalId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [goalId]);

  useEffect(() => { load(); }, [load]);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streamingText]);

  // Any pending tool calls from the latest assistant message?
  const pendingCalls = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      const pending = m.toolCalls?.filter(t => t.status === 'pending') ?? [];
      if (pending.length) return pending;
      break;
    }
    return [];
  }, [messages]);

  const handleStreamEvent = useCallback((e: ChatStreamEvent) => {
    if (e.type === 'text_delta') {
      setStreamingText(prev => prev + e.delta);
    } else if (e.type === 'message_start') {
      // Server persisted the assistant message — refetch history to reflect it + clear the buffer.
      setStreamingText('');
      load();
    } else if (e.type === 'tool_use_auto_start' || e.type === 'tool_use_result' || e.type === 'tool_use_pending') {
      // These mutate the message row; refetch.
      load();
    } else if (e.type === 'error') {
      setError(e.error);
      setStreaming(false);
    } else if (e.type === 'done') {
      setStreaming(false);
      setStreamingText('');
      load();
    }
  }, [load]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput('');
    setStreaming(true);
    setStreamingText('');
    // Optimistically append the user message so the UI feels instant.
    setMessages(prev => [...prev, {
      id: `pending-${Date.now()}`,
      goalId,
      role: 'user',
      content: text,
      toolCalls: [],
      toolUseId: null,
      toolResult: null,
      model: null,
      createdAt: new Date().toISOString(),
    }]);
    cancelRef.current = streamChatTurn(goalId, text, handleStreamEvent);
  }, [input, streaming, goalId, handleStreamEvent]);

  const handleConfirm = useCallback((tc: ChatToolCall, accept: boolean) => {
    if (streaming) return;
    setError(null);
    setStreaming(true);
    setStreamingText('');
    cancelRef.current = streamChatConfirm(goalId, tc.id, accept, undefined, handleStreamEvent);
  }, [goalId, streaming, handleStreamEvent]);

  const handleCancel = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setStreaming(false);
    setStreamingText('');
    load();
  }, [load]);

  const handleClear = useCallback(async () => {
    if (!confirm('Clear all chat history for this goal?')) return;
    await clearChatHistory(goalId);
    setMessages([]);
    setError(null);
  }, [goalId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-brand" />
          <span className="text-[13px] font-semibold text-primary">Chat</span>
          <span className="text-[11px] text-muted">scoped to this goal</span>
        </div>
        <button
          onClick={handleClear}
          disabled={messages.length === 0}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-red-600 disabled:opacity-40"
          title="Clear conversation history"
        >
          <Trash2 size={11} /> Clear
        </button>
      </div>

      {/* Feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto bg-surface-1 rounded-xl p-3 space-y-2">
        {messages.length === 0 && !streaming && (
          <EmptyState />
        )}
        {messages.map(m => <MessageRow key={m.id} msg={m} onConfirm={handleConfirm} streaming={streaming} />)}
        {streaming && streamingText && (
          <div className="flex gap-2">
            <div className="shrink-0 w-6 h-6 rounded-lg bg-brand-light flex items-center justify-center">
              <Bot size={12} className="text-brand" />
            </div>
            <div className="flex-1 text-[12.5px] text-primary leading-relaxed whitespace-pre-wrap">
              {streamingText}
              <span className="inline-block w-1.5 h-3 bg-brand/60 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}
        {streaming && !streamingText && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <Loader2 size={12} className="animate-spin" />
            <span>thinking…</span>
            <button onClick={handleCancel} className="text-[11px] text-muted hover:text-red-600 ml-2">cancel</button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-700 flex items-start gap-2 shrink-0">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><XIcon size={12} /></button>
        </div>
      )}

      {pendingCalls.length > 0 && !streaming && (
        <div className="mt-2 space-y-1.5 shrink-0">
          {pendingCalls.map(tc => (
            <PendingConfirmCard key={tc.id} toolCall={tc} onConfirm={() => handleConfirm(tc, true)} onDecline={() => handleConfirm(tc, false)} />
          ))}
        </div>
      )}

      {/* Input */}
      <div className="mt-2 shrink-0">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask the goal operator — refine context, audit tasks, draft new tasks, trigger the planner…"
            rows={3}
            disabled={streaming || pendingCalls.length > 0}
            className="input resize-none !py-2.5 !pr-12 text-[13px] leading-relaxed disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming || pendingCalls.length > 0}
            className="absolute bottom-2 right-2 p-1.5 rounded-md bg-brand text-white disabled:opacity-40 hover:bg-brand-dim transition-colors"
            title="Send (⌘↵)"
          >
            <Send size={12} />
          </button>
        </div>
        <div className="mt-1 text-[10px] text-muted px-1 flex items-center gap-2">
          <kbd>⌘↵</kbd> to send
          {pendingCalls.length > 0 && <span className="text-amber-600 font-medium ml-auto">pending confirm</span>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Message row ---------- */

function MessageRow({ msg, onConfirm, streaming }: {
  msg: ChatMessage;
  onConfirm: (tc: ChatToolCall, accept: boolean) => void;
  streaming: boolean;
}) {
  if (msg.role === 'tool') {
    return <ToolResultRow msg={msg} />;
  }
  const isUser = msg.role === 'user';
  return (
    <div className="flex gap-2">
      <div className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center ${isUser ? 'bg-surface-2' : 'bg-brand-light'}`}>
        {isUser ? <User size={12} className="text-muted" /> : <Bot size={12} className="text-brand" />}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {msg.content && (
          <div className="text-[12.5px] text-primary leading-relaxed whitespace-pre-wrap break-words">
            {msg.content}
          </div>
        )}
        {msg.toolCalls?.map(tc => (
          <ToolCallRow key={tc.id} toolCall={tc} onConfirm={onConfirm} streaming={streaming} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Tool call card (inline in assistant message) ---------- */

function ToolCallRow({ toolCall, onConfirm, streaming }: {
  toolCall: ChatToolCall;
  onConfirm: (tc: ChatToolCall, accept: boolean) => void;
  streaming: boolean;
}) {
  const { name, input, status, result, error } = toolCall;
  const destructive = ['update_task', 'approve_task', 'decline_task', 'delete_task', 'update_goal_context', 'run_planner'].includes(name);

  const statusColor = {
    auto:     { text: '#059669', bg: '#F0FDF8', label: 'ran' },
    accepted: { text: '#059669', bg: '#F0FDF8', label: 'confirmed' },
    pending:  { text: '#D97706', bg: '#FFFBF0', label: 'awaiting confirm' },
    declined: { text: '#6B7280', bg: '#F3F4F6', label: 'declined' },
    errored:  { text: '#DC2626', bg: '#FEF2F2', label: 'failed' },
  }[status];

  return (
    <div className="card-flat px-3 py-2 text-[11.5px]">
      <div className="flex items-center gap-1.5 mb-1">
        {destructive ? <ShieldAlert size={11} className="text-amber-600" /> : <Wrench size={11} className="text-muted" />}
        <span className="font-mono font-semibold text-primary">{name}</span>
        <span className="tag" style={{ color: statusColor.text, backgroundColor: statusColor.bg }}>{statusColor.label}</span>
      </div>
      <div className="font-mono text-[10.5px] text-muted/80 truncate" title={JSON.stringify(input)}>
        {JSON.stringify(input).slice(0, 160)}{JSON.stringify(input).length > 160 ? '…' : ''}
      </div>
      {error && (
        <div className="mt-1 text-[11px] text-red-700">{error}</div>
      )}
      {result !== undefined && result !== null && (
        <details className="mt-1">
          <summary className="text-[10.5px] text-muted cursor-pointer hover:text-secondary">result</summary>
          <pre className="mt-1 mono-block !max-h-[120px]">{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
      {status === 'pending' && !streaming && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={() => onConfirm(toolCall, true)}
            className="btn btn-success btn-xs gap-1"
          >
            <Check size={10} /> Confirm
          </button>
          <button
            onClick={() => onConfirm(toolCall, false)}
            className="btn btn-danger-ghost btn-xs gap-1"
          >
            <XIcon size={10} /> Decline
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Separate "Confirm required" banner above the input ---------- */

function PendingConfirmCard({ toolCall, onConfirm, onDecline }: {
  toolCall: ChatToolCall;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="card-flat px-3 py-2 border-amber-300 bg-amber-50 flex items-center gap-2">
      <ShieldAlert size={14} className="text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold text-amber-900">Confirm <span className="font-mono">{toolCall.name}</span></div>
        <div className="text-[10.5px] text-amber-800/80 font-mono truncate" title={JSON.stringify(toolCall.input)}>
          {JSON.stringify(toolCall.input).slice(0, 140)}
        </div>
      </div>
      <button onClick={onConfirm} className="btn btn-success btn-xs gap-1 shrink-0">
        <Check size={10} /> Confirm
      </button>
      <button onClick={onDecline} className="btn btn-danger-ghost btn-xs gap-1 shrink-0">
        <XIcon size={10} /> Decline
      </button>
    </div>
  );
}

/* ---------- Tool result row (server-side result of a tool call) ---------- */

function ToolResultRow({ msg }: { msg: ChatMessage }) {
  const hasError = msg.toolResult && typeof msg.toolResult === 'object' && 'error' in (msg.toolResult as object);
  const declined = msg.toolResult && typeof msg.toolResult === 'object' && 'declined_by_user' in (msg.toolResult as object);
  if (declined) return null;   // don't clutter; the assistant's tool card already shows declined state
  return (
    <div className="flex gap-2 opacity-80">
      <div className="shrink-0 w-6 h-6" />
      <details className="flex-1 text-[11px]">
        <summary className="text-muted cursor-pointer hover:text-secondary flex items-center gap-1">
          <Wrench size={10} /> tool_result {msg.toolUseId?.slice(0, 10)}…
          {hasError ? <span className="text-red-600">failed</span> : null}
        </summary>
        <pre className="mt-1 mono-block !max-h-[120px]">
          {typeof msg.toolResult === 'string' ? msg.toolResult : JSON.stringify(msg.toolResult, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/* ---------- Empty state ---------- */

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center py-12 text-center">
      <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center mb-3">
        <MessageSquare size={16} className="text-brand" />
      </div>
      <p className="text-[13px] font-medium text-secondary mb-1">Chat with the goal operator</p>
      <p className="text-[11.5px] text-muted max-w-[300px] leading-relaxed">
        Refine context, audit tasks, draft new ones, trigger the planner. Destructive actions ask for confirm.
      </p>
    </div>
  );
}
