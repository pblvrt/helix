import { useEffect, useMemo, useState } from 'react';
import { Bot, Plug, FileText, Loader2, Check } from 'lucide-react';
import {
  fetchAgents, fetchMcpConnections, fetchGoalMcpIds, setGoalMcpIds,
  type AgentDescriptor, type McpConnection, type Goal,
} from '../../api/client';
import { useUpdateGoal } from '../../hooks/queries/useGoals';

export default function GoalContextTab({ goal, onUpdate }: { goal: Goal; onUpdate: () => void }) {
  const updateMutation = useUpdateGoal();

  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [mcpList, setMcpList] = useState<McpConnection[]>([]);

  const initialAgent = goal.agentType || 'seo';
  const initialMd = typeof goal.context?.markdown === 'string' ? (goal.context.markdown as string) : '';

  const [agent, setAgent] = useState(initialAgent);
  const [mcpIds, setMcpIdsState] = useState<string[]>([]);
  const [initialMcpIds, setInitialMcpIds] = useState<string[]>([]);
  const [contextMd, setContextMd] = useState(initialMd);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [a, m, ids] = await Promise.all([fetchAgents(), fetchMcpConnections(), fetchGoalMcpIds(goal.id)]);
        setAgents(a);
        setMcpList(m);
        setMcpIdsState(ids);
        setInitialMcpIds(ids);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
    // reset local state when goal id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal.id]);

  const isDirty = useMemo(() => {
    if (agent !== initialAgent) return true;
    if (contextMd !== initialMd) return true;
    if (mcpIds.length !== initialMcpIds.length) return true;
    const a = [...mcpIds].sort().join(',');
    const b = [...initialMcpIds].sort().join(',');
    return a !== b;
  }, [agent, contextMd, mcpIds, initialAgent, initialMd, initialMcpIds]);

  async function save() {
    if (!isDirty || saving) return;
    setSaving(true);
    setError('');
    try {
      if (agent !== initialAgent || contextMd !== initialMd) {
        await updateMutation.mutateAsync({
          id: goal.id,
          data: {
            agentType: agent,
            context: { ...(goal.context || {}), markdown: contextMd },
          } as Partial<Goal>,
        });
      }
      const a = [...mcpIds].sort().join(',');
      const b = [...initialMcpIds].sort().join(',');
      if (a !== b) {
        await setGoalMcpIds(goal.id, mcpIds);
        setInitialMcpIds(mcpIds);
      }
      onUpdate();
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {isDirty && (
        <div className="mb-4 flex items-center justify-between px-4 py-2 rounded-lg bg-amber-50 border border-amber-200">
          <div className="text-[12.5px] text-amber-800">Unsaved changes to this goal.</div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-brand text-white text-[12px] font-medium hover:bg-brand/90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save changes
          </button>
        </div>
      )}
      {savedAt && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-[12px]">Saved.</div>
      )}
      {error && <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-[12px]">{error}</div>}

      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Bot size={13} className="text-brand" />
          <h3 className="text-[13px] font-semibold text-primary">Agent</h3>
        </div>
        <select
          value={agent}
          onChange={e => setAgent(e.target.value)}
          className="w-full max-w-[420px] px-3 py-2 border border-edge rounded-md text-[13px] bg-white focus:outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/10"
        >
          {agents.map(a => (
            <option key={a.name} value={a.name}>
              {a.name}{a.description ? ` — ${a.description.slice(0, 70)}${a.description.length > 70 ? '…' : ''}` : ''}
            </option>
          ))}
          {!agents.length && <option value={initialAgent}>{initialAgent}</option>}
        </select>
      </section>

      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Plug size={13} className="text-brand" />
          <h3 className="text-[13px] font-semibold text-primary">
            MCP connections <span className="text-muted font-normal">({mcpIds.length}/{mcpList.length} enabled)</span>
          </h3>
        </div>
        {mcpList.length === 0 ? (
          <div className="p-3 rounded-md bg-surface-1 text-[12px] text-muted">
            No MCP servers configured. Add some from the MCP page.
          </div>
        ) : (
          <div className="space-y-1.5 max-w-[520px]">
            {mcpList.map(m => (
              <label
                key={m.id}
                className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition ${
                  mcpIds.includes(m.id) ? 'border-brand/40 bg-brand/5' : 'border-edge hover:border-brand/20 hover:bg-surface-1/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={mcpIds.includes(m.id)}
                  onChange={() =>
                    setMcpIdsState(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-primary">{m.name}</div>
                  {m.url && <div className="text-[11px] font-mono text-muted truncate">{m.url}</div>}
                </div>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={13} className="text-brand" />
          <h3 className="text-[13px] font-semibold text-primary">Context</h3>
        </div>
        <p className="text-[11.5px] text-muted mb-2">
          Embedded into every task's payload. The planner and subagents read this before any work.
        </p>
        <textarea
          value={contextMd}
          onChange={e => setContextMd(e.target.value)}
          rows={14}
          className="w-full px-3 py-2.5 bg-white border border-edge rounded-lg text-[12.5px] font-mono leading-relaxed focus:outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/10 resize-y"
        />
        <div className="text-[11px] text-muted mt-1">{contextMd.length} chars</div>
      </section>
    </div>
  );
}
