import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Zap, Play, Square, Clock, Loader2, Check, Terminal, RotateCcw, Settings,
} from 'lucide-react';
import {
  streamActionEvents, fetchActionLog,
  fetchTaskCounts, fetchTasks,
  type LogEntry, type Action, type Task,
} from '../api/client';
import {
  useActionsStatus, useActionHistory, useSchedules,
  useSubmitAction, useStopAction,
  useCreateSchedule, useUpdateSchedule, useDeleteSchedule,
} from '../hooks/queries/useActions';
import {
  type ActivityItem, parseLogEntry, CRON_PRESETS, cronToHuman,
} from './agent/agentUtils';
import ActivityRow from './agent/ActivityRow';

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Executor() {
  // --- Executor settings (persisted to localStorage for now) ---
  const [maxTasks, setMaxTasks] = useState<string>(() => localStorage.getItem('executor.maxTasks') || '');
  const [onlyType, setOnlyType] = useState<string>(() => localStorage.getItem('executor.onlyType') || '');
  const [onlyGoalId, setOnlyGoalId] = useState<string>(() => localStorage.getItem('executor.onlyGoalId') || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (setter: (v: string) => void, key: string) => (v: string) => {
    setter(v);
    localStorage.setItem(`executor.${key}`, v);
    setDirty(true);
    setSaved(false);
  };

  const handleSave = () => {
    setSaving(true);
    // localStorage is the backing store; this is just a UX cue.
    setTimeout(() => {
      setSaving(false); setSaved(true); setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    }, 150);
  };

  // --- Run state ---
  const { data: actionsStatus } = useActionsStatus();
  const { data: actionHistory } = useActionHistory();
  const { data: schedules } = useSchedules();
  const submitMutation = useSubmitAction();
  const stopMutation = useStopAction();
  const createScheduleMutation = useCreateSchedule();
  const updateScheduleMutation = useUpdateSchedule();
  const deleteScheduleMutation = useDeleteSchedule();

  const [log, setLog] = useState<LogEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'activity' | 'settings'>('activity');
  const feedRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  // --- Task counts + recent done (for header + sidebar) ---
  const [counts, setCounts] = useState<{ backlog: number; in_progress: number; done: number; blocked: number }>({
    backlog: 0, in_progress: 0, done: 0, blocked: 0,
  });
  const [recentDone, setRecentDone] = useState<Task[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [c, done] = await Promise.all([fetchTaskCounts(), fetchTasks({ status: 'done', limit: 5 })]);
        if (!cancelled) { setCounts(c); setRecentDone(done); }
      } catch {}
    }
    tick();
    const i = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const executorRuns = useMemo(
    () => (actionHistory as Action[] || []).filter(r => r.actionType === 'execute'),
    [actionHistory],
  );
  const activeAction = (actionsStatus as any)?.activeAction;
  const isExecutorRunning = activeAction?.actionType === 'execute';
  const running = isExecutorRunning;
  const runId = running ? String(activeAction.id) : null;
  const schedule = schedules?.find(s => s.command === 'execute') || null;

  // Auto-select latest run
  useEffect(() => {
    if (runId) setSelectedRunId(runId);
    else if (!selectedRunId && executorRuns.length) setSelectedRunId(executorRuns[0].id);
  }, [runId, executorRuns.length]);

  // Load log for selected run + stream if live
  useEffect(() => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    setLog([]); seenRef.current.clear();
    if (!selectedRunId) return;

    fetchActionLog(selectedRunId).then(entries => {
      for (const e of entries) {
        const key = `${e.timestamp}:${JSON.stringify(e.data).slice(0, 80)}`;
        seenRef.current.add(key);
      }
      setLog(entries);
    }).catch(() => {});

    const isLive = selectedRunId === runId && running;
    if (isLive) {
      const cleanup = streamActionEvents(selectedRunId, (entry: LogEntry) => {
        const key = `${entry.timestamp}:${JSON.stringify(entry.data).slice(0, 80)}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        setLog(prev => [...prev, entry]);
      });
      cleanupRef.current = cleanup;
      return cleanup;
    }
  }, [selectedRunId, running, runId]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [log.length]);

  const activityItems = useMemo(
    () => log.map((e, i) => parseLogEntry(e, i)).filter(Boolean) as ActivityItem[],
    [log],
  );

  // Derived stats for the header (adapted from graph-scrape's computeStats)
  const stats = useMemo(() => {
    let toolCalls = 0;
    let errors = 0;
    for (const it of activityItems) {
      if (it.kind === 'tool' || it.kind === 'navigate' || it.kind === 'extract') toolCalls++;
      if (it.kind === 'error') errors++;
    }
    return { toolCalls, errors };
  }, [activityItems]);

  const [runError, setRunError] = useState<string | null>(null);
  const argsString = useMemo(() => {
    const parts: string[] = [];
    if (maxTasks && Number(maxTasks) > 0) parts.push(`maxTasks=${Number(maxTasks)}`);
    if (onlyType.trim()) parts.push(`onlyType=${onlyType.trim()}`);
    if (onlyGoalId.trim()) parts.push(`onlyGoalId=${onlyGoalId.trim()}`);
    return parts.join(' ');
  }, [maxTasks, onlyType, onlyGoalId]);

  const handleRun = async () => {
    if (starting) return;
    setStarting(true); setRightTab('activity'); setRunError(null);
    try {
      await submitMutation.mutateAsync({ command: 'execute', args: argsString || undefined });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to start executor');
    } finally {
      setStarting(false);
    }
  };
  const handleStop = async () => { try { if (runId) await stopMutation.mutateAsync(runId); } catch {} };

  const handleSaveSchedule = async (cron: string) => {
    try {
      if (schedule) await updateScheduleMutation.mutateAsync({ id: schedule.id, data: { cronExpression: cron, enabled: true } });
      else await createScheduleMutation.mutateAsync({ command: 'execute', cronExpression: cron, description: 'Executor', enabled: true });
      setEditingSchedule(null);
    } catch {}
  };
  const handleDeleteSchedule = async () => { if (!schedule) return; try { await deleteScheduleMutation.mutateAsync(schedule.id); setEditingSchedule(null); } catch {} };
  const handleToggleSchedule = async () => { if (!schedule) return; try { await updateScheduleMutation.mutateAsync({ id: schedule.id, data: { enabled: !schedule.enabled } }); } catch {} };

  const selectedRun = executorRuns.find(r => r.id === selectedRunId);

  return (
    <div className="page-full flex gap-4">
      {/* ─── LEFT: Run history ─── */}
      <div className="w-[280px] shrink-0 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-1">
          <Zap size={16} className="text-brand" />
          <h1 className="text-[18px] font-bold tracking-tight">Executor</h1>
        </div>

        {/* Queue state pill */}
        <div className="flex items-center gap-3 mb-4 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            {counts.backlog} queued
          </span>
          {counts.in_progress > 0 && (
            <span className="flex items-center gap-1 text-emerald-600">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {counts.in_progress} running
            </span>
          )}
          {counts.done > 0 && <span>{counts.done} done</span>}
        </div>

        {/* Schedule pill */}
        {schedule && (
          <div className="flex items-center gap-2 mb-4 text-[11px]">
            <Clock size={10} className={schedule.enabled ? 'text-emerald-500' : 'text-muted'} />
            <span className={schedule.enabled ? 'text-emerald-600' : 'text-muted line-through'}>
              {cronToHuman(schedule.cronExpression)}
            </span>
          </div>
        )}

        {/* Run history */}
        <div className="flex-1 overflow-y-auto space-y-1 mb-3">
          <div className="section-label mb-2 px-1">Runs</div>
          {executorRuns.length === 0 && (
            <p className="text-[12px] text-muted px-2 py-4">No runs yet</p>
          )}
          {executorRuns.map(run => {
            const isActive = run.id === runId && running;
            const isSelected = run.id === selectedRunId;
            return (
              <button
                key={run.id}
                onClick={() => { setSelectedRunId(run.id); setRightTab('activity'); }}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center gap-2.5 ${
                  isSelected ? 'bg-brand-light border border-brand/20' : 'hover:bg-surface-1'
                }`}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  isActive ? 'bg-amber-400 animate-pulse'
                  : run.status === 'done' ? 'bg-emerald-400'
                  : run.status === 'error' || run.status === 'failed' || run.status === 'crashed' ? 'bg-red-400'
                  : run.status === 'stopped' || run.status === 'cancelled' ? 'bg-gray-400'
                  : 'bg-surface-3'
                }`} />
                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-medium text-primary block">
                    {isActive ? 'Running'
                     : run.status === 'done' ? 'Completed'
                     : run.status === 'error' || run.status === 'failed' ? 'Failed'
                     : run.status}
                  </span>
                  {run.startedAt && (
                    <span className="text-[10px] text-muted">{timeAgo(run.startedAt)}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Recently done tasks */}
        {recentDone.length > 0 && (
          <div className="shrink-0 mb-3 space-y-1">
            <div className="section-label mb-1 px-1">Recently done</div>
            {recentDone.map(t => (
              <div key={t.id} className="px-3 py-1.5 rounded-lg bg-surface-1">
                <div className="text-[10px] font-mono text-muted truncate">{t.type}</div>
                <div className="text-[11.5px] text-secondary truncate">{t.title}</div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="shrink-0 space-y-1.5">
          {running ? (
            <button onClick={handleStop} className="btn btn-danger-ghost btn-sm w-full gap-2">
              <Square size={12} /> Stop Executor
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={starting || counts.backlog === 0}
              className="btn btn-primary btn-sm w-full gap-2"
              title={counts.backlog === 0 ? 'Backlog is empty' : 'Run the backlog'}
            >
              {starting ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {starting ? 'Starting...' : 'Run Executor'}
            </button>
          )}
        </div>

        {runError && (
          <p className="text-[11px] text-red-500 mt-2 px-2">{runError}</p>
        )}
      </div>

      {/* ─── RIGHT: Tabbed panel ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="card-flat px-4 py-2 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setRightTab('activity')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${rightTab === 'activity' ? 'bg-surface-2 text-primary' : 'text-muted hover:text-secondary'}`}
            >
              <Terminal size={12} /> Activity
            </button>
            <button
              onClick={() => setRightTab('settings')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${rightTab === 'settings' ? 'bg-surface-2 text-primary' : 'text-muted hover:text-secondary'}`}
            >
              <Settings size={12} /> Settings
              {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>

            {/* Run info in tab bar */}
            {rightTab === 'activity' && selectedRun && (
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-edge">
                <span className="text-[11px] font-medium text-secondary">executor</span>
                {running && selectedRunId === runId && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                  </span>
                )}
                {selectedRun.status === 'done' && <span className="tag text-emerald-700 bg-emerald-50">Done</span>}
                {(selectedRun.status === 'error' || selectedRun.status === 'failed') && <span className="tag text-red-600 bg-red-50">Failed</span>}
              </div>
            )}

            {/* Save bar */}
            {rightTab === 'settings' && (
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-edge">
                <span className="text-[11px]">
                  {dirty ? <span className="flex items-center gap-1.5 text-amber-600 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Unsaved changes</span>
                    : saved ? <span className="flex items-center gap-1.5 text-emerald-600 font-medium"><Check size={11} /> Saved</span>
                    : <span className="text-muted">All saved</span>}
                </span>
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className={`btn btn-sm ${dirty ? 'btn-primary' : 'btn-ghost opacity-50 cursor-not-allowed'}`}
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                  {saving ? 'Saving' : 'Save'}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {rightTab === 'activity' && activityItems.length > 0 && (
              <>
                <span className="text-[11px] text-secondary font-medium">{stats.toolCalls} tool calls</span>
                {stats.errors > 0 && <span className="text-[11px] text-red-500 font-medium">{stats.errors} errors</span>}
              </>
            )}
            {rightTab === 'activity' && log.length > 0 && !running && (
              <button onClick={() => { setLog([]); seenRef.current.clear(); }} className="text-[11px] text-muted hover:text-secondary flex items-center gap-1"><RotateCcw size={10} /> Clear</button>
            )}
          </div>
        </div>

        {/* Activity tab */}
        {rightTab === 'activity' && (
          <div ref={feedRef} className="flex-1 bg-surface-1 rounded-xl overflow-y-auto">
            {activityItems.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center mb-3">
                  <Zap size={20} className="text-muted" />
                </div>
                <p className="text-[13px] font-medium text-secondary mb-1">
                  {!selectedRun ? 'No runs yet' : running ? 'Starting...' : 'No activity recorded'}
                </p>
                <p className="text-[12px] text-muted">Run the executor to see activity here</p>
              </div>
            )}
            <div className="p-3 space-y-1">
              {activityItems.map(item => <ActivityRow key={item.id} item={item} />)}
            </div>
          </div>
        )}

        {/* Settings tab */}
        {rightTab === 'settings' && (
          <div className="flex-1 overflow-y-auto">
            <div className="pt-2 pb-12 space-y-8 max-w-[960px]">

              {/* Schedule */}
              <section>
                <div className="section-label mb-3 px-1">Schedule</div>
                <div className="card px-5 py-4">
                  {editingSchedule !== null ? (
                    <ScheduleEditor
                      initial={editingSchedule}
                      onSave={handleSaveSchedule}
                      onCancel={() => setEditingSchedule(null)}
                      onDelete={schedule ? handleDeleteSchedule : undefined}
                    />
                  ) : schedule ? (
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-brand-light flex items-center justify-center shrink-0">
                        <Clock size={14} className="text-brand" />
                      </div>
                      <span className="flex-1 text-[13px] text-primary font-medium">{cronToHuman(schedule.cronExpression)}</span>
                      <button onClick={handleToggleSchedule} className={`text-[11px] font-semibold px-2.5 py-1 rounded-md ${schedule.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-muted'}`}>{schedule.enabled ? 'On' : 'Off'}</button>
                      <button onClick={() => setEditingSchedule(schedule.cronExpression)} className="text-[12px] text-brand font-semibold hover:underline">Edit</button>
                    </div>
                  ) : (
                    <button onClick={() => setEditingSchedule('0 9,13,17 * * 1-5')} className="flex items-center gap-2 text-[13px] text-muted hover:text-primary transition-colors">
                      <Clock size={14} />
                      Set up a schedule
                    </button>
                  )}
                </div>
              </section>

              {/* Run scope */}
              <section>
                <div className="section-label mb-3 px-1">Run scope</div>
                <div className="card divide-y divide-edge">
                  <SettingRow
                    label="Max tasks per run"
                    hint="Stop after this many tasks even if the backlog has more. Blank = unlimited."
                  >
                    <NumberInputOrBlank
                      value={maxTasks}
                      onChange={update(setMaxTasks, 'maxTasks')}
                      placeholder="(unlimited)"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Only run type"
                    hint="Process only one task type (e.g. publish-social). Blank = any."
                  >
                    <TextInput
                      value={onlyType}
                      onChange={update(setOnlyType, 'onlyType')}
                      placeholder="(any)"
                      mono
                    />
                  </SettingRow>
                  <SettingRow
                    label="Only goal"
                    hint="Filter to tasks from a specific goal ID. Blank = any."
                  >
                    <TextInput
                      value={onlyGoalId}
                      onChange={update(setOnlyGoalId, 'onlyGoalId')}
                      placeholder="(any)"
                      mono
                    />
                  </SettingRow>
                </div>
              </section>

              {/* How it runs */}
              <section>
                <div className="section-label mb-3 px-1">How it runs</div>
                <div className="card px-5 py-4 space-y-2 text-[12.5px] text-secondary leading-relaxed">
                  <p><span className="font-semibold">One at a time.</span> Tasks are processed sequentially (priority ASC, created ASC).</p>
                  <p><span className="font-semibold">Per-task subprocess.</span> Each task spawns its own <code className="font-mono bg-surface-2 px-1 rounded">claude -p</code> run via <code className="font-mono bg-surface-2 px-1 rounded">POST /api/tasks/:id/run</code>.</p>
                  <p><span className="font-semibold">Status is automatic.</span> Exit 0 → done, non-zero → task reverts to backlog for retry.</p>
                  <p><span className="font-semibold">Stop kills the active subprocess.</span> In-progress task goes back to backlog.</p>
                  <p><span className="font-semibold">CAPTCHA halts everything.</span> Reported by a task subprocess → executor exits entirely.</p>
                </div>
              </section>

              {/* Skills */}
              <section>
                <div className="section-label mb-3 px-1">Available skills</div>
                <div className="card px-5 py-4">
                  <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[12px]">
                    {[
                      ['linkedin-connections', 'Send / withdraw / accept LinkedIn invites'],
                      ['linkedin-messages',    'Send M1 / R1 / R2, detect replies'],
                      ['linkedin-verify',      'Reconcile CRM vs LinkedIn state'],
                      ['linkedin-publish-post','Publish a LinkedIn feed post'],
                      ['x-publish-thread',     'Publish an X thread'],
                      ['reddit-publish',       'Publish a subreddit post'],
                      ['ga-scrape',            'Scrape Google Analytics via Chrome'],
                      ['search-console-scrape','Scrape Search Console via Chrome'],
                      ['directory-submit-form','Fill a directory submission form'],
                    ].map(([name, desc]) => (
                      <div key={name} className="flex items-baseline gap-2 min-w-0">
                        <code className="font-mono text-[11.5px] text-brand bg-brand-light px-1.5 py-0.5 rounded shrink-0">{name}</code>
                        <span className="text-secondary leading-snug truncate">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reusable bits (near-1:1 copies from Outreach.tsx) ───

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-primary leading-snug">{label}</div>
        {hint && <div className="text-[12px] text-muted leading-relaxed mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberInputOrBlank({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      min={1}
      className="w-28 text-[13px] font-mono text-primary bg-white border border-edge rounded-md px-3 py-1.5 focus:outline-none focus:ring-[3px] focus:ring-brand/10 focus:border-edge-focus transition-all"
    />
  );
}

function TextInput({ value, onChange, placeholder, mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-44 text-[13px] ${mono ? 'font-mono' : ''} text-primary bg-white border border-edge rounded-md px-3 py-1.5 focus:outline-none focus:ring-[3px] focus:ring-brand/10 focus:border-edge-focus transition-all`}
    />
  );
}

function ScheduleEditor({ initial, onSave, onCancel, onDelete }: {
  initial: string; onSave: (cron: string) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [cron, setCron] = useState(initial);
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <input
          type="text" value={cron} onChange={e => setCron(e.target.value)}
          className="input input-mono text-[11px] py-1 flex-1" placeholder="0 * * * *" autoFocus
        />
        <button onClick={() => onSave(cron)} className="btn btn-primary btn-xs">Save</button>
        <button onClick={onCancel} className="btn btn-ghost btn-xs">Cancel</button>
        {onDelete && <button onClick={onDelete} className="btn btn-ghost btn-xs !text-red-500 hover:!bg-red-50">Del</button>}
      </div>
      <div className="flex flex-wrap gap-1">
        {CRON_PRESETS.map(p => (
          <button
            key={p.cron}
            onClick={() => setCron(p.cron)}
            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${cron === p.cron ? 'bg-brand text-white border-brand' : 'border-edge text-muted hover:border-gray-300'}`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-[9px] text-muted self-center ml-1">{cronToHuman(cron)}</span>
      </div>
    </div>
  );
}
