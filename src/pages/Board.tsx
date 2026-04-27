import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Kanban, Trash2, Search, X, RefreshCw, Zap, Loader2,
  FileText, Image as ImageIcon, Link2, StickyNote, ExternalLink, Check, MessageSquareX,
  ShieldCheck, ListTree, History, Clock,
} from 'lucide-react';
import type { Task, TaskStatus, TaskArtifact, OnDoneTaskSpec, ReviewHistoryEntry } from '../api/client';
import {
  fetchTasks, fetchTaskCounts, updateTask, deleteTask,
  approveTask, declineTask, openArtifact,
} from '../api/client';
import ArtifactViewer from '../components/ArtifactViewer';

/**
 * Column model — matches graph-scrape's Dashboard pipeline:
 *   colored dot + label + count badge per column, tinted column background,
 *   horizontally scrollable lanes of 260px-wide cards.
 *
 *   - Backlog visually contains `backlog` AND `in_progress` — the latter is a
 *     transient "agent working on this card" state, shown as a spinner badge.
 *   - Needs Review is human-gated: Approve → done (+ spawn chain), Decline →
 *     feedback textarea → back to backlog.
 *   - Blocked is first-class.
 *   - Done is terminal.
 */
interface ColumnConfig {
  key: 'backlog' | 'needs_review' | 'blocked' | 'done';
  label: string;
  color: string;   // dot + accent color
  bg: string;      // column background tint
  match: (t: Task) => boolean;
}

const COLUMNS: ColumnConfig[] = [
  { key: 'backlog',      label: 'Backlog',      color: '#6B7280', bg: '#F9FAFB', match: t => t.status === 'backlog' || t.status === 'in_progress' },
  { key: 'needs_review', label: 'Needs review', color: '#D97706', bg: '#FFFBF0', match: t => t.status === 'needs_review' },
  { key: 'blocked',      label: 'Blocked',      color: '#DC2626', bg: '#FEF2F2', match: t => t.status === 'blocked' },
  { key: 'done',         label: 'Done',         color: '#059669', bg: '#F0FDF8', match: t => t.status === 'done' },
];

const PRIORITY_COLORS: Record<number, { text: string; bg: string }> = {
  1: { text: '#DC2626', bg: '#FEF2F2' },
  2: { text: '#D97706', bg: '#FFFBF0' },
  3: { text: '#2563EB', bg: '#EFF6FF' },
  4: { text: '#6B7280', bg: '#F3F4F6' },
  5: { text: '#6B7280', bg: '#F3F4F6' },
};

export default function Board() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [counts, setCounts] = useState<Record<TaskStatus, number>>({
    backlog: 0, in_progress: 0, needs_review: 0, done: 0, blocked: 0,
  });
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [goalFilter, setGoalFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Task | null>(null);
  const [viewingArtifact, setViewingArtifact] = useState<TaskArtifact | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineText, setDeclineText] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([fetchTasks({}), fetchTaskCounts()]);
      setTasks(t);
      setCounts(c);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load tasks');
    }
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 4000);
    return () => clearInterval(i);
  }, [load]);

  const types = useMemo(() => Array.from(new Set(tasks.map(t => t.type))).sort(), [tasks]);
  const goals = useMemo(() => {
    const ids = new Map<string, string>();
    for (const t of tasks) {
      const gc = (t.payload?.goalContext as Record<string, unknown> | undefined);
      const gid = typeof gc?.goalId === 'string' ? gc.goalId : null;
      const gtitle = typeof gc?.goalTitle === 'string' ? gc.goalTitle : gid || '';
      if (gid && !ids.has(gid)) ids.set(gid, gtitle);
    }
    return Array.from(ids.entries()).map(([id, title]) => ({ id, title }));
  }, [tasks]);

  const hasFilters = !!(search.trim() || typeFilter !== 'all' || goalFilter !== 'all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (goalFilter !== 'all') {
        const gid = (t.payload?.goalContext as Record<string, unknown> | undefined)?.goalId;
        if (gid !== goalFilter) return false;
      }
      if (q) {
        const hay = `${t.title} ${t.reason} ${t.summary} ${t.type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, search, typeFilter, goalFilter]);

  const byColumn = useMemo(() => {
    const map: Record<ColumnConfig['key'], Task[]> = { backlog: [], needs_review: [], blocked: [], done: [] };
    for (const t of filtered) {
      for (const col of COLUMNS) {
        if (col.match(t)) { map[col.key].push(t); break; }
      }
    }
    // Within a column: priority asc, then newest first.
    for (const key of Object.keys(map) as ColumnConfig['key'][]) {
      // Within a column: ready tasks first (priority asc, then newest), then
      // future-scheduled tasks (earliest wake-up first). Scheduling only
      // affects ordering within the Backlog lane; other columns ignore it.
      map[key].sort((a, b) => {
        const aScheduled = a.scheduledFor && new Date(a.scheduledFor).getTime() > Date.now();
        const bScheduled = b.scheduledFor && new Date(b.scheduledFor).getTime() > Date.now();
        if (aScheduled !== bScheduled) return aScheduled ? 1 : -1;
        if (aScheduled && bScheduled) {
          return (new Date(a.scheduledFor!).getTime()) - (new Date(b.scheduledFor!).getTime());
        }
        return (a.priority - b.priority) || b.createdAt.localeCompare(a.createdAt);
      });
    }
    return map;
  }, [filtered]);

  async function onStatus(t: Task, status: TaskStatus) {
    setBusyId(t.id);
    try {
      await updateTask(t.id, { status } as Partial<Task>);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to update');
    } finally { setBusyId(null); }
  }

  async function onApprove(t: Task) {
    setBusyId(t.id);
    try { await approveTask(t.id); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Failed to approve'); }
    finally { setBusyId(null); }
  }

  async function onDecline(t: Task) {
    const feedback = declineText.trim();
    if (!feedback) return;
    setBusyId(t.id);
    try {
      await declineTask(t.id, feedback);
      setDecliningId(null);
      setDeclineText('');
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to decline');
    } finally { setBusyId(null); }
  }

  async function onDelete(t: Task) {
    if (!confirm(`Delete "${t.title}"?`)) return;
    setBusyId(t.id);
    try { await deleteTask(t.id); await load(); if (selected?.id === t.id) setSelected(null); }
    finally { setBusyId(null); }
  }

  return (
    <div className="page-full flex flex-col">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <Kanban size={16} className="text-brand" />
          <h1 className="page-title">Board</h1>
          <span className="text-[11px] text-muted ml-2">
            {counts.backlog + counts.in_progress} backlog · {counts.needs_review} review · {counts.blocked} blocked · {counts.done} done
            {counts.in_progress > 0 && <span className="ml-1 text-brand">· {counts.in_progress} running</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a href="#/executor" className="btn btn-primary btn-sm gap-1.5">
            <Zap size={12} /> Executor
          </a>
          <button onClick={load} className="btn btn-ghost btn-sm gap-1.5">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-3 px-3 py-2 bg-amber-50 text-amber-800 text-[12.5px] rounded-xl shrink-0 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-amber-600 hover:text-amber-900"><X size={12} /></button>
        </div>
      )}

      {/* ─── Filter bar ─── */}
      <div className="mb-3 shrink-0 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-[360px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search title, summary, reason..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-[13px] bg-white border border-edge rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40 transition-all"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="text-[12px] px-2.5 py-2 bg-white border border-edge rounded-xl focus:outline-none focus:border-brand/40"
        >
          <option value="all">All types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={goalFilter}
          onChange={e => setGoalFilter(e.target.value)}
          className="text-[12px] px-2.5 py-2 bg-white border border-edge rounded-xl focus:outline-none focus:border-brand/40"
        >
          <option value="all">All goals</option>
          {goals.map(g => <option key={g.id} value={g.id}>#{g.id} · {g.title.slice(0, 40)}{g.title.length > 40 ? '…' : ''}</option>)}
        </select>
        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setTypeFilter('all'); setGoalFilter('all'); }}
            className="text-[11px] text-muted hover:text-primary transition-colors"
          >
            Clear
          </button>
        )}
        <span className="text-[11px] text-muted ml-auto">{filtered.length} of {tasks.length} tasks</span>
      </div>

      {/* ─── Columns ─── */}
      <div className="flex gap-3 flex-1 min-h-0 overflow-x-auto pb-2">
        {COLUMNS.map(col => {
          const colTasks = byColumn[col.key];
          return (
            <div key={col.key} className="flex flex-col min-h-0 min-w-[280px] w-[280px] shrink-0">
              <div className="flex items-center justify-between mb-3 px-1 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="text-[12px] font-semibold text-primary whitespace-nowrap">{col.label}</span>
                  <span className="text-[10px] font-mono text-muted bg-surface-2 px-1.5 py-0.5 rounded-md">
                    {colTasks.length}
                  </span>
                </div>
              </div>

              <div
                className="flex-1 rounded-xl p-2 space-y-2 overflow-y-auto border border-transparent"
                style={{ backgroundColor: col.bg }}
              >
                {colTasks.length === 0 && (
                  <div className="text-center py-8 text-[11px] text-muted">Empty</div>
                )}
                {colTasks.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onStatus={(s) => onStatus(t, s)}
                    onApprove={() => onApprove(t)}
                    onDecline={() => onDecline(t)}
                    onDelete={() => onDelete(t)}
                    onOpen={() => setSelected(t)}
                    busy={busyId === t.id}
                    declining={decliningId === t.id}
                    declineText={declineText}
                    setDeclineText={setDeclineText}
                    setDeclining={(on) => setDecliningId(on ? t.id : null)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} onOpenArtifact={setViewingArtifact} />}
      {viewingArtifact && <ArtifactViewer artifact={viewingArtifact} onClose={() => setViewingArtifact(null)} />}
    </div>
  );
}

/* ─── Task card ─── */

interface TaskCardProps {
  task: Task;
  onStatus: (s: TaskStatus) => void;
  onApprove: () => void;
  onDecline: () => void;
  onDelete: () => void;
  onOpen: () => void;
  busy: boolean;
  declining: boolean;
  declineText: string;
  setDeclineText: (s: string) => void;
  setDeclining: (on: boolean) => void;
}

function TaskCard({
  task, onStatus, onApprove, onDecline, onDelete, onOpen, busy,
  declining, declineText, setDeclineText, setDeclining,
}: TaskCardProps) {
  const goal = (task.payload?.goalContext as Record<string, unknown> | undefined);
  const goalId = typeof goal?.goalId === 'string' ? goal.goalId : null;
  const goalTitle = typeof goal?.goalTitle === 'string' ? goal.goalTitle : null;
  const chainedFrom = typeof task.payload?.chainedFrom === 'string' ? task.payload.chainedFrom : null;
  const prio = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[3];
  const summary = task.summary || task.reason || task.definitionOfDone;

  return (
    <div
      className="card relative px-3 py-2.5 !rounded-xl cursor-pointer hover:shadow-md transition-shadow"
      onClick={onOpen}
    >
      {/* Header row — type, priority, title */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9.5px] font-mono text-muted uppercase tracking-wide truncate">{task.type}</span>
            {task.status === 'in_progress' && (
              <span className="flex items-center gap-0.5 text-[9.5px] text-brand font-semibold">
                <Loader2 size={9} className="animate-spin" /> running
              </span>
            )}
          </div>
          <span className="text-[12.5px] font-semibold text-primary line-clamp-2 leading-snug block">{task.title}</span>
        </div>
        <span
          className="tag shrink-0"
          style={{ color: prio.text, backgroundColor: prio.bg }}
          title={`Priority ${task.priority}`}
        >
          P{task.priority}
        </span>
      </div>

      {/* Decline feedback (if declined and back in backlog) */}
      {task.reviewFeedback && (
        <div className="mt-1.5 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[10.5px] text-amber-900 leading-snug">
          <span className="font-semibold">Declined:</span> <span className="line-clamp-2 inline">{task.reviewFeedback}</span>
        </div>
      )}

      {/* Summary / reason / DoD */}
      {summary && (
        <p className="text-[10.5px] text-secondary leading-relaxed line-clamp-2 mt-1.5">
          {summary}
        </p>
      )}

      {/* Artifacts strip */}
      {task.artifacts && task.artifacts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.artifacts.slice(0, 2).map((a, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded-md bg-surface-1 text-muted">
              <ArtifactIcon kind={a.kind} />
              <span className="truncate max-w-[100px]">{a.label}</span>
            </span>
          ))}
          {task.artifacts.length > 2 && (
            <span className="text-[9.5px] text-muted/70 px-1">+{task.artifacts.length - 2}</span>
          )}
        </div>
      )}

      {/* Meta strip — verification, chain, goal, scheduled */}
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {task.scheduledFor && new Date(task.scheduledFor).getTime() > Date.now() && (
          <span className="inline-flex items-center gap-1 text-[9.5px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md" title={`Runs ${new Date(task.scheduledFor).toLocaleString()}`}>
            <Clock size={9} /> in {formatUntil(task.scheduledFor)}
          </span>
        )}
        {task.verification && task.verification.kind !== 'manual' && (
          <span className="inline-flex items-center gap-1 text-[9.5px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md" title={`Auto-verify: ${task.verification.kind}`}>
            <ShieldCheck size={9} /> {task.verification.kind}
          </span>
        )}
        {task.onDone && task.onDone.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[9.5px] text-brand bg-brand-light px-1.5 py-0.5 rounded-md" title={`Spawns ${task.onDone.length} follow-up(s) on done`}>
            <ListTree size={9} /> +{task.onDone.length}
          </span>
        )}
        {chainedFrom && (
          <span className="text-[9.5px] text-muted" title={`Chained from #${chainedFrom}`}>
            ← #{chainedFrom}
          </span>
        )}
        {goalId && (
          <Link
            to={`/goals/${goalId}`}
            onClick={e => e.stopPropagation()}
            className="text-[9.5px] text-muted hover:text-brand truncate ml-auto"
            title={goalTitle || ''}
          >
            goal #{goalId}
          </Link>
        )}
      </div>

      {/* Decline editor */}
      {declining && (
        <div className="mt-2 pt-2 border-t border-edge/60" onClick={e => e.stopPropagation()}>
          <textarea
            autoFocus
            value={declineText}
            onChange={e => setDeclineText(e.target.value)}
            placeholder="Why are you declining? Feedback goes to the agent on the next attempt."
            className="input text-[12px] !py-1.5 !px-2 resize-none"
            rows={3}
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              onClick={onDecline}
              disabled={busy || !declineText.trim()}
              className="btn btn-xs gap-1 !text-white"
              style={{ backgroundColor: '#DC2626' }}
            >
              <MessageSquareX size={10} /> Send back
            </button>
            <button
              onClick={() => { setDeclining(false); setDeclineText(''); }}
              className="btn btn-ghost btn-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Quick actions */}
      {!declining && (
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-edge/50" onClick={e => e.stopPropagation()}>
          {task.status === 'needs_review' ? (
            <>
              <button
                onClick={onApprove}
                disabled={busy}
                className="btn btn-success btn-xs gap-1"
                title="Approve — runs verification, flips to done, spawns chain"
              >
                <Check size={10} /> Approve
              </button>
              <button
                onClick={() => setDeclining(true)}
                disabled={busy}
                className="btn btn-danger-ghost btn-xs gap-1"
                title="Decline with feedback — goes back to backlog"
              >
                <MessageSquareX size={10} /> Decline
              </button>
            </>
          ) : (
            <select
              value={task.status}
              onChange={e => onStatus(e.target.value as TaskStatus)}
              disabled={busy || task.status === 'in_progress'}
              className="text-[10px] text-muted bg-surface-2 border border-edge rounded-md px-1.5 py-0.5 disabled:opacity-50 focus:outline-none"
              title="Move status"
            >
              <option value="backlog">backlog</option>
              {task.status === 'in_progress' && <option value="in_progress" disabled>in_progress</option>}
              <option value="needs_review">needs_review</option>
              <option value="blocked">blocked</option>
              {task.status === 'done' && <option value="done" disabled>done</option>}
            </select>
          )}
          <div className="flex-1" />
          {task.runId && task.status === 'in_progress' && (
            <span className="text-[9.5px] font-mono text-brand bg-brand-light px-1.5 py-0.5 rounded-md">
              {task.runId.slice(-6)}
            </span>
          )}
          {task.status !== 'in_progress' && (
            <button
              onClick={onDelete}
              disabled={busy}
              className="p-1 rounded-md text-muted hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Drawer ─── */

function TaskDrawer({
  task, onClose, onOpenArtifact,
}: {
  task: Task;
  onClose: () => void;
  onOpenArtifact: (a: TaskArtifact) => void;
}) {
  const goal = task.payload?.goalContext as Record<string, unknown> | undefined;
  const goalId = typeof goal?.goalId === 'string' ? goal.goalId : null;
  const restPayload = Object.fromEntries(
    Object.entries(task.payload || {}).filter(([k]) => k !== 'goalContext')
  );
  const prio = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS[3];
  const statusColor = COLUMNS.find(c => c.match(task))?.color || '#6B7280';

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end p-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-[560px] max-h-[88vh] bg-white rounded-2xl shadow-2xl border border-edge flex flex-col overflow-hidden animate-in">
        <header className="px-5 py-4 border-b border-edge">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-muted uppercase tracking-wider">{task.type}</span>
                <span className="text-[10px] font-mono text-muted">#{task.id}</span>
                <span className="tag" style={{ color: prio.text, backgroundColor: prio.bg }}>P{task.priority}</span>
                <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: statusColor }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                  {task.status.replace('_', ' ')}
                </span>
              </div>
              <h3 className="text-[16px] font-bold text-primary leading-tight">{task.title}</h3>
              {task.reason && <p className="text-[12px] text-muted italic mt-1">{task.reason}</p>}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-secondary hover:bg-surface-1 transition-colors">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[12.5px]">
          {/* Timestamps */}
          <div className="grid grid-cols-3 gap-3 text-[11px]">
            <KV label="Source" value={task.source} />
            <KV label="Created" value={relative(task.createdAt)} />
            <KV label="Completed" value={task.completedAt ? relative(task.completedAt) : '—'} />
          </div>
          {task.scheduledFor && (
            <div className="card-flat px-4 py-2.5 flex items-center gap-2 text-[12px]">
              <Clock size={12} className="text-amber-600" />
              <span className="text-secondary">Scheduled for</span>
              <span className="font-mono text-primary">{new Date(task.scheduledFor).toLocaleString()}</span>
              {new Date(task.scheduledFor).getTime() > Date.now() && (
                <span className="ml-auto tag" style={{ color: '#D97706', backgroundColor: '#FFFBF0' }}>
                  in {formatUntil(task.scheduledFor)}
                </span>
              )}
            </div>
          )}

          {/* Definition of done */}
          {task.definitionOfDone && (
            <section className="bg-surface-1 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-secondary">
                <ShieldCheck size={11} /> Definition of done
              </div>
              <p className="text-[13px] text-primary leading-relaxed whitespace-pre-wrap">{task.definitionOfDone}</p>
            </section>
          )}

          {/* Verification */}
          {task.verification && (
            <section>
              <div className="section-label mb-1.5 px-1">Verification</div>
              <div className="card-flat px-4 py-2.5">
                <div className="text-[11px] font-mono text-muted mb-0.5">{task.verification.kind}</div>
                <pre className="text-[11px] font-mono text-primary whitespace-pre-wrap break-all leading-snug">
                  {JSON.stringify(
                    Object.fromEntries(Object.entries(task.verification).filter(([k]) => k !== 'kind')),
                    null, 2,
                  )}
                </pre>
              </div>
            </section>
          )}

          {/* Latest decline feedback */}
          {task.reviewFeedback && (
            <section className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold text-amber-700">
                <MessageSquareX size={11} /> Latest decline feedback
              </div>
              <p className="text-[13px] text-amber-900 leading-relaxed whitespace-pre-wrap">{task.reviewFeedback}</p>
            </section>
          )}

          {/* Review history */}
          {task.reviewHistory && task.reviewHistory.length > 0 && (
            <section>
              <div className="section-label mb-1.5 px-1 flex items-center gap-1.5">
                <History size={11} /> Review history ({task.reviewHistory.length})
              </div>
              <div className="space-y-1.5">
                {task.reviewHistory.map((h: ReviewHistoryEntry, i) => (
                  <div key={i} className="card-flat px-3.5 py-2.5 text-[11.5px]">
                    <div className="text-[10px] font-mono text-muted mb-1">{relative(h.at)}</div>
                    <p className="text-secondary whitespace-pre-wrap leading-relaxed">{h.feedback}</p>
                    {h.summaryAtDecline && (
                      <div className="mt-1.5 pt-1.5 border-t border-edge text-[10.5px] text-muted italic">
                        previous attempt: {h.summaryAtDecline}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Chain follow-ups */}
          {task.onDone && task.onDone.length > 0 && (
            <section>
              <div className="section-label mb-1.5 px-1 flex items-center gap-1.5">
                <ListTree size={11} /> Spawns on done ({task.onDone.length})
              </div>
              <div className="space-y-1.5">
                {task.onDone.map((c: OnDoneTaskSpec, i) => (
                  <div key={i} className="card-flat px-3.5 py-2">
                    <div className="text-[10px] font-mono text-muted">{c.type}</div>
                    <div className="text-[12.5px] text-primary">{c.title}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Agent summary */}
          {task.summary && (
            <section>
              <div className="section-label mb-1.5 px-1">Agent summary</div>
              <div className="bg-surface-1 rounded-xl px-4 py-3 text-[12.5px] text-secondary leading-relaxed">
                {task.summary}
              </div>
            </section>
          )}

          {/* Artifacts */}
          {task.artifacts && task.artifacts.length > 0 && (
            <section>
              <div className="section-label mb-1.5 px-1">Artifacts ({task.artifacts.length})</div>
              <div className="space-y-1.5">
                {task.artifacts.map((a, i) => <ArtifactRow key={i} artifact={a} onOpen={() => onOpenArtifact(a)} />)}
              </div>
            </section>
          )}

          {/* Payload */}
          {Object.keys(restPayload).length > 0 && (
            <section>
              <div className="section-label mb-1.5 px-1">Payload</div>
              <pre className="mono-block !max-h-none">
                {JSON.stringify(restPayload, null, 2)}
              </pre>
            </section>
          )}

          {/* Goal */}
          {goal && (
            <section>
              <div className="section-label mb-1.5 px-1 flex items-center justify-between">
                <span>Goal context</span>
                {goalId && <Link to={`/goals/${goalId}`} className="text-brand text-[11px] font-normal normal-case hover:underline">open →</Link>}
              </div>
              <div className="card-flat px-4 py-3 space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-mono text-muted uppercase">#{String(goal.goalId ?? '')}</span>
                  {typeof goal.agentType === 'string' && (
                    <span className="tag" style={{ color: '#2563EB', backgroundColor: '#EFF6FF' }}>{goal.agentType}</span>
                  )}
                </div>
                {typeof goal.goalTitle === 'string' && (
                  <div className="text-[13px] text-primary font-medium">{goal.goalTitle}</div>
                )}
                {typeof goal.context === 'string' && goal.context.trim() && (
                  <pre className="mono-block mt-2">{goal.context}</pre>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

/** "Runs in 3d", "Runs in 2h 15m" — for scheduledFor timestamps in the future. */
function formatUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (isNaN(ms) || ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return h >= 2 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24); return d >= 2 ? `${d}d` : `${d}d ${h % 24}h`;
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime();
  if (isNaN(ms) || ms < 0) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7)  return `${d}d ago`;
  return iso.slice(0, 10);
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9.5px] font-semibold text-muted uppercase tracking-wider">{label}</div>
      <div className="text-[11.5px] text-primary mt-0.5 break-all">{value}</div>
    </div>
  );
}

function ArtifactIcon({ kind }: { kind: TaskArtifact['kind'] }) {
  switch (kind) {
    case 'file':       return <FileText size={9} />;
    case 'screenshot': return <ImageIcon size={9} />;
    case 'url':        return <Link2 size={9} />;
    case 'note':       return <StickyNote size={9} />;
    default:           return <FileText size={9} />;
  }
}

function ArtifactRow({ artifact, onOpen }: { artifact: TaskArtifact; onOpen: () => void }) {
  const target = artifact.path || artifact.url || '';
  const display = target || '—';
  const isExternal = artifact.kind === 'url';

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-xl border border-edge bg-white hover:border-gray-300 transition-colors">
      <span className="mt-0.5 text-muted shrink-0"><ArtifactIcon kind={artifact.kind} /></span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-primary truncate">{artifact.label}</div>
        <div className="text-[10.5px] font-mono text-muted truncate">{display}</div>
      </div>
      {isExternal && target ? (
        <button
          onClick={() => openArtifact(target).catch(err => alert(err instanceof Error ? err.message : String(err)))}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-brand hover:bg-brand-light shrink-0 transition-colors"
        >
          <ExternalLink size={11} /> Open
        </button>
      ) : (
        <button
          onClick={onOpen}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-brand hover:bg-brand-light shrink-0 transition-colors"
        >
          <ExternalLink size={11} /> View
        </button>
      )}
    </div>
  );
}
