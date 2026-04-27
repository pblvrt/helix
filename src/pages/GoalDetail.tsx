import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Clock, Square, Terminal, Trash2,
  CheckCircle, XCircle, FileText, Bot, MessageSquare,
  RotateCcw, Play, ChevronRight, ChevronDown,
} from 'lucide-react';
import GoalContextTab from './goal/GoalContextTab';
import GoalChatTab from './goal/GoalChatTab';
import {
  fetchActionLog, streamActionEvents, stopGoal as apiStopGoal,
  type Goal, type Action, type LogEntry,
} from '../api/client';
import { useGoalDetail, useUpdateGoal, useStartGoal, useDeleteGoal } from '../hooks/queries/useGoals';
import { useActionsStatus } from '../hooks/queries/useActions';
import {
  type ActiveRunInfo, type ActivityItem,
  formatElapsed, parseLogEntry,
  CRON_PRESETS, cronToHuman,
} from './agent/agentUtils';
import ActivityRow from './agent/ActivityRow';

export default function GoalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: goal, isLoading: loadingGoal, refetch: refetchGoal } = useGoalDetail(id!);
  const startMutation = useStartGoal();
  const deleteMutation = useDeleteGoal();
  const { data: actionsStatus } = useActionsStatus();

  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  const [activeRun, setActiveRun] = useState<ActiveRunInfo | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00');
  const seenRef = useRef<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [rightTab, setRightTab] = useState<'activity' | 'chat' | 'context' | 'schedule'>('activity');

  const [expandedOldRuns, setExpandedOldRuns] = useState<Set<number>>(new Set());

  const allActions = useMemo(() => (goal?.jobs ?? []).flatMap(j => j.actions), [goal?.jobs]);

  const addLogEntry = useCallback((entry: LogEntry) => {
    const key = `${entry.timestamp}:${JSON.stringify(entry.data).slice(0, 100)}`;
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);
    setLog(prev => [...prev, entry]);
  }, []);

  const handleStreamEvent = useCallback((entry: LogEntry, opts?: { isReconnect?: boolean }) => {
    if (entry.type === 'status') {
      const d = entry.data;
      if (d.runId && !opts?.isReconnect) {
        setActiveRun({
          id: d.runId as string,
          command: (d.command as string) || '',
          status: (d.status as string) || 'running',
          pid: d.pid as number | undefined,
          started_at: (d.started_at as string) || new Date().toISOString(),
        });
      }
      addLogEntry(entry);
      if (d.status === 'done' || d.status === 'error') {
        setRunning(false); setActiveRun(null);
        if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
        refetchGoal();
      }
    } else {
      addLogEntry(entry);
    }
  }, [addLogEntry, refetchGoal]);

  const loadActionLog = useCallback((action: Action) => {
    setSelectedActionId(action.id);
    if (action.startedAt) {
      if (cleanupRef.current) cleanupRef.current();
      seenRef.current.clear();

      fetchActionLog(action.id).then(entries => {
        setLog(entries);
        for (const e of entries) {
          const key = `${e.timestamp}:${JSON.stringify(e.data).slice(0, 100)}`;
          seenRef.current.add(key);
        }

        if (action.status === 'running') {
          setRunning(true);
          cleanupRef.current = streamActionEvents(action.id, e => handleStreamEvent(e, { isReconnect: true }));
        } else {
          setRunning(false);
        }
      }).catch(() => setLog([]));
    } else {
      setLog([]);
      setRunning(false);
    }
  }, [handleStreamEvent]);

  const checkedRef = useRef(false);
  useEffect(() => {
    if (!actionsStatus || checkedRef.current) return;
    checkedRef.current = true;
    if (actionsStatus.running && actionsStatus.activeAction) {
      setRunning(true);
      setActiveRun({
        id: actionsStatus.activeAction.id,
        command: actionsStatus.activeAction.actionType,
        status: actionsStatus.activeAction.status,
        pid: actionsStatus.activeAction.pid,
        started_at: actionsStatus.activeAction.startedAt || new Date().toISOString(),
      });
    }
  }, [actionsStatus, id]);

  useEffect(() => {
    return () => { if (cleanupRef.current) cleanupRef.current(); };
  }, [id]);

  useEffect(() => {
    if (!allActions?.length) return;

    const runningAction = allActions.find(t => t.status === 'running');
    if (runningAction && runningAction.id !== selectedActionId) {
      loadActionLog(runningAction);
      return;
    }

    if (!selectedActionId || !allActions.find(t => t.id === selectedActionId)) {
      const lastDone = [...allActions].reverse().find(t => t.status === 'done' || t.status === 'failed');
      const toSelect = lastDone || allActions[0];
      if (toSelect) loadActionLog(toSelect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allActions?.map(t => `${t.id}:${t.status}`).join(',')]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
    if (running && activeRun?.started_at) {
      setElapsedDisplay(formatElapsed(activeRun.started_at));
      elapsedRef.current = setInterval(() => {
        if (activeRun?.started_at) setElapsedDisplay(formatElapsed(activeRun.started_at));
      }, 1000);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [running, activeRun?.started_at]);

  const handleStop = useCallback(async () => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (id) await apiStopGoal(id);
    setRunning(false); setActiveRun(null);
    setLog(prev => [...prev, { type: 'status', data: { status: 'stopped' }, timestamp: Date.now() }]);
    refetchGoal();
  }, [id, refetchGoal]);

  const handleRerun = useCallback(async () => {
    if (running || !id || goal?.status === 'active' || goal?.status === 'planning') return;
    try { await startMutation.mutateAsync(id); } catch {}
  }, [running, id, goal?.status, startMutation]);

  const handleDelete = useCallback(async () => {
    if (!id || running) return;
    try { await deleteMutation.mutateAsync(id); navigate('/'); } catch {}
  }, [id, running, deleteMutation, navigate]);

  const activityItems = useMemo(
    () => log.map((e, i) => parseLogEntry(e, i)).filter(Boolean) as ActivityItem[],
    [log],
  );

  if (loadingGoal && !goal) {
    return (
      <div className="page-full flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }
  if (!goal) {
    return (
      <div className="page-full flex items-center justify-center">
        <p className="text-[14px] text-muted">Goal not found.</p>
      </div>
    );
  }

  const progress = goal.targetCount
    ? Math.min(100, Math.round((goal.currentCount / goal.targetCount) * 100))
    : null;
  const isRunning = goal.status === 'active' || goal.status === 'planning';
  const selectedAction = allActions.find(t => t.id === selectedActionId);

  return (
    <div className="page-full flex gap-4">
      <div className="w-[280px] shrink-0 flex flex-col overflow-hidden">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-[12px] text-muted hover:text-secondary mb-3"
        >
          <ArrowLeft size={13} /> Goals
        </button>

        <h1 className="text-[15px] font-bold text-primary leading-snug mb-2">{goal.title}</h1>

        {goal.targetCount ? (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${goal.status === 'completed' ? 'bg-emerald-500' : 'bg-brand'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[12px] font-bold text-primary">{goal.currentCount}/{goal.targetCount}</span>
          </div>
        ) : (
          <p className="text-[12px] text-muted mb-4">{goal.currentCount} completed</p>
        )}

        <div className="flex-1 overflow-y-auto mb-3">
          {allActions.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted">
              {goal.status === 'planning' ? (
                <><Loader2 size={12} className="animate-spin" /> Planning...</>
              ) : (
                <>No actions yet. Start the goal to begin.</>
              )}
            </div>
          )}
          {(() => {
            const jobs = [...(goal.jobs || [])].reverse();

            return jobs.map((job, ji) => {
              const actions = job.actions;
              const isLatest = ji === 0;
              const allDone = actions.every(
                t => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled' || t.status === 'crashed',
              );
              const jobNum = Number(job.id);
              const isOpen = isLatest || expandedOldRuns.has(jobNum);
              const toggle = () => {
                if (isLatest) return;
                setExpandedOldRuns(prev => {
                  const next = new Set(prev);
                  if (next.has(jobNum)) next.delete(jobNum); else next.add(jobNum);
                  return next;
                });
              };

              return (
                <div key={job.id} className={`${ji > 0 ? 'mt-2 pt-2 border-t border-edge' : ''}`}>
                  <button
                    onClick={toggle}
                    className={`w-full section-label mb-1 px-1 flex items-center justify-between transition-colors ${isLatest ? '' : 'hover:text-secondary cursor-pointer'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {!isLatest && (isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
                      <span>Job #{job.id}</span>
                      <span className="text-[9px] font-normal normal-case text-muted">
                        ({actions.length} action{actions.length === 1 ? '' : 's'}{job.status === 'cancelled' ? ' · cancelled' : ''})
                      </span>
                    </div>
                    {allDone && !isLatest && <span className="text-[9px] text-muted font-normal normal-case">{job.status}</span>}
                    {isLatest && !allDone && <span className="text-[9px] text-brand font-normal normal-case">latest</span>}
                  </button>
                  {isOpen && (
                    <div className="relative">
                      {actions.length > 1 && <div className="absolute left-[15px] top-4 bottom-4 w-px bg-edge" />}
                      {actions.map((action, i) => (
                        <ActionStep
                          key={action.id}
                          action={action}
                          index={i}
                          isSelected={action.id === selectedActionId}
                          onClick={() => loadActionLog(action)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>

        <div className="space-y-1.5 shrink-0">
          {isRunning ? (
            <button onClick={handleStop} className="btn btn-danger-ghost btn-sm w-full gap-2">
              <Square size={12} /> Stop
            </button>
          ) : (
            <button onClick={handleRerun} className="btn btn-primary btn-sm w-full gap-2">
              <Play size={12} /> Run Again
            </button>
          )}
          {!isRunning && (
            <button
              onClick={handleDelete}
              className="btn btn-ghost btn-sm w-full gap-2 text-muted hover:text-red-500 hover:bg-red-50"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </div>

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
              onClick={() => setRightTab('chat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${rightTab === 'chat' ? 'bg-surface-2 text-primary' : 'text-muted hover:text-secondary'}`}
            >
              <MessageSquare size={12} /> Chat
            </button>
            <button
              onClick={() => setRightTab('context')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${rightTab === 'context' ? 'bg-surface-2 text-primary' : 'text-muted hover:text-secondary'}`}
            >
              <FileText size={12} /> Context
            </button>
            <button
              onClick={() => setRightTab('schedule')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${rightTab === 'schedule' ? 'bg-surface-2 text-primary' : 'text-muted hover:text-secondary'}`}
            >
              <Clock size={12} /> Schedule
            </button>
            <span className="ml-2 pl-2 border-l border-edge inline-flex items-center gap-1 text-[11px] font-mono text-muted">
              <Bot size={10} /> {goal.agentType || 'seo'}
            </span>
            {rightTab === 'activity' && selectedAction && (
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-edge">
                <Terminal size={12} className="text-muted" />
                <span className="text-[11px] font-medium text-secondary">{selectedAction.actionType}</span>
                {selectedAction.status === 'running' && running && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {elapsedDisplay}
                  </span>
                )}
                {selectedAction.status === 'done' && <span className="tag text-emerald-700 bg-emerald-50">Done</span>}
                {selectedAction.status === 'failed' && <span className="tag text-red-600 bg-red-50">Failed</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {rightTab === 'activity' && log.length > 0 && !running && (
              <button
                onClick={() => { setLog([]); seenRef.current.clear(); }}
                className="text-[11px] text-muted hover:text-secondary flex items-center gap-1"
              >
                <RotateCcw size={10} /> Clear
              </button>
            )}
          </div>
        </div>

        {rightTab === 'activity' && (
          <div ref={feedRef} className="flex-1 bg-surface-1 rounded-xl overflow-y-auto">
            {activityItems.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-16">
                <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center mb-3">
                  <Terminal size={20} className="text-muted" />
                </div>
                <p className="text-[13px] font-medium text-secondary mb-1">
                  {!selectedAction ? 'Select an action' : selectedAction.status === 'pending' ? 'Waiting to run' : 'No activity recorded'}
                </p>
              </div>
            )}
            <div className="p-3 space-y-1">
              {activityItems.map(item => <ActivityRow key={item.id} item={item} />)}
            </div>
          </div>
        )}

        {rightTab === 'chat' && (
          <GoalChatTab goalId={goal.id} />
        )}

        {rightTab === 'context' && (
          <GoalContextTab goal={goal} onUpdate={refetchGoal} />
        )}

        {rightTab === 'schedule' && (
          <GoalScheduleTab goal={goal} onUpdate={refetchGoal} />
        )}
      </div>
    </div>
  );
}

function GoalScheduleTab({ goal, onUpdate }: { goal: Goal; onUpdate: () => void }) {
  const updateMutation = useUpdateGoal();
  const [cron, setCron] = useState(goal.cronExpression || '');
  const [editing, setEditing] = useState(!goal.cronExpression);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMutation.mutateAsync({ id: goal.id, data: { cronExpression: cron || null } as any });
      onUpdate();
      setEditing(false);
    } catch {} finally { setSaving(false); }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await updateMutation.mutateAsync({ id: goal.id, data: { cronExpression: null } as any });
      setCron('');
      onUpdate();
      setEditing(true);
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="card px-5 py-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-muted" />
          </div>
          <div>
            <span className="text-[14px] font-semibold block">Schedule this goal</span>
            <span className="text-[11px] text-muted">Automatically re-run this goal on a schedule</span>
          </div>
        </div>

        {goal.cronExpression && !editing ? (
          <div className="flex items-center gap-3 bg-surface-1 rounded-lg px-4 py-2.5">
            <Clock size={13} className="text-muted shrink-0" />
            <span className="text-[12px] text-secondary flex-1">{cronToHuman(goal.cronExpression)}</span>
            <span className="text-[10px] font-mono text-muted">{goal.cronExpression}</span>
            <button onClick={() => setEditing(true)} className="text-[11px] text-brand hover:text-brand-dim font-medium">Edit</button>
            <button onClick={handleRemove} className="text-[11px] text-muted hover:text-red-500 font-medium">Remove</button>
          </div>
        ) : (
          <div className="bg-surface-1 rounded-lg p-4 space-y-3">
            <input
              type="text"
              value={cron}
              onChange={e => setCron(e.target.value)}
              className="input input-mono text-[12px] py-2"
              placeholder="0 9 * * 1-5"
            />
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.cron}
                  onClick={() => setCron(p.cron)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-all ${cron === p.cron ? 'bg-brand text-white border-brand' : 'border-edge text-muted hover:border-gray-300'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {cron && <p className="text-[11px] text-muted"><Clock size={10} className="inline mr-1 -mt-px" />{cronToHuman(cron)}</p>}
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={!cron || saving} className="btn btn-primary btn-sm flex-1">
                {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save Schedule'}
              </button>
              {goal.cronExpression && (
                <button onClick={() => { setEditing(false); setCron(goal.cronExpression || ''); }} className="btn btn-ghost btn-sm">
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionStep({
  action, index, isSelected, onClick,
}: {
  action: Action;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isActive = action.status === 'running';
  const isDone = action.status === 'done';
  const isFailed = action.status === 'failed' || action.status === 'error';

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-all rounded-lg relative ${isSelected ? 'bg-brand-light' : 'hover:bg-surface-1'}`}
    >
      <div className={`w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5 relative z-10 ${isActive ? 'bg-brand' : isDone ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-gray-200'}`}>
        {isActive ? <Loader2 size={10} className="animate-spin text-white" /> :
         isDone ? <CheckCircle size={10} className="text-white" /> :
         isFailed ? <XCircle size={10} className="text-white" /> :
         <span className="text-[8px] font-bold text-gray-500">{index + 1}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[12px] font-semibold ${isSelected ? 'text-brand' : 'text-primary'}`}>{action.actionType}</span>
          {isActive && <span className="text-[9px] font-medium text-brand bg-brand/10 px-1.5 py-0.5 rounded">RUNNING</span>}
        </div>
        {action.resultSummary && (
          <p className="text-[10px] text-muted mt-0.5 line-clamp-2">{action.resultSummary}</p>
        )}
      </div>
    </button>
  );
}
