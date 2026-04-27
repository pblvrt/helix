import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, X, Bot, Plug, FileText } from 'lucide-react';
import {
  fetchAgents, fetchMcpConnections, setGoalMcpIds, type AgentDescriptor, type McpConnection,
} from '../../api/client';
import { useCreateGoal, useStartGoal } from '../../hooks/queries/useGoals';

type StepId = 'agent' | 'context';

interface Props {
  title: string;
  targetCount: string;
  onClose: () => void;
}

export default function NewGoalWizard({ title, targetCount, onClose }: Props) {
  const navigate = useNavigate();
  const createMut = useCreateGoal();
  const startMut = useStartGoal();

  const [step, setStep] = useState<StepId>('agent');
  const [agents, setAgents] = useState<AgentDescriptor[]>([]);
  const [mcpList, setMcpList] = useState<McpConnection[]>([]);
  const [agentName, setAgentName] = useState<string>('seo');
  const [mcpIds, setMcpIds] = useState<string[]>([]);
  const [contextMd, setContextMd] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [a, m] = await Promise.all([fetchAgents(), fetchMcpConnections()]);
        setAgents(a);
        setMcpList(m);
        if (a.length && !a.find(x => x.name === agentName)) {
          setAgentName(a[0].name);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load wizard data');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canNextFromAgent = !!agentName;
  const canFinish = !!agentName && !submitting;

  async function handleFinish() {
    if (!canFinish) return;
    setSubmitting(true);
    setError('');
    try {
      const goal = await createMut.mutateAsync({
        title: title.trim(),
        targetCount: targetCount ? Number(targetCount) : undefined,
        agentType: agentName,
        context: { markdown: contextMd.trim() },
      });
      if (mcpIds.length > 0) {
        await setGoalMcpIds(goal.id, mcpIds);
      }
      await startMut.mutateAsync(goal.id);
      navigate(`/goals/${goal.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create goal');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="w-full max-w-[720px] max-h-[88vh] bg-white rounded-2xl shadow-2xl border border-edge flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b border-edge">
          <div className="flex items-center gap-3">
            <StepPill index={1} label="Agent"   active={step === 'agent'}   done={step !== 'agent'} />
            <StepPill index={2} label="Context" active={step === 'context'} done={false} />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-1">
            <X size={16} />
          </button>
        </header>

        <div className="px-6 py-5 flex-1 overflow-y-auto">
          <div className="mb-4 pb-4 border-b border-edge">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">Goal</div>
            <div className="text-[13px] text-primary leading-snug">{title}</div>
            {targetCount && <div className="text-[11px] text-muted mt-0.5">Target: {targetCount}</div>}
          </div>

          {loading && (
            <div className="py-12 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          )}

          {!loading && step === 'agent' && (
            <AgentStep
              agents={agents}
              selected={agentName}
              onSelect={setAgentName}
            />
          )}

          {!loading && step === 'context' && (
            <ContextStep
              mcpList={mcpList}
              mcpIds={mcpIds}
              onToggleMcp={(id) => setMcpIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
              contextMd={contextMd}
              onChangeContext={setContextMd}
            />
          )}
        </div>

        <footer className="flex items-center justify-between px-5 py-3 border-t border-edge bg-surface-1/40">
          {error ? (
            <div className="text-[12px] text-red-600">{error}</div>
          ) : <div />}
          <div className="flex items-center gap-2">
            {step === 'agent' && (
              <>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-md text-[12.5px] text-muted hover:text-secondary hover:bg-surface-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep('context')}
                  disabled={!canNextFromAgent}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-[12.5px] font-medium hover:bg-brand/90 disabled:opacity-50"
                >
                  Next <ArrowRight size={12} />
                </button>
              </>
            )}
            {step === 'context' && (
              <>
                <button
                  onClick={() => setStep('agent')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] text-muted hover:text-secondary hover:bg-surface-1"
                >
                  <ArrowLeft size={12} /> Back
                </button>
                <button
                  onClick={handleFinish}
                  disabled={!canFinish}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-[12.5px] font-medium hover:bg-brand/90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Create &amp; start
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function StepPill({ index, label, active, done }: { index: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 text-[12px] font-medium ${active ? 'text-brand' : done ? 'text-muted' : 'text-muted/60'}`}>
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
        active ? 'bg-brand text-white' :
        done ? 'bg-emerald-100 text-emerald-700' :
        'bg-surface-1 text-muted'
      }`}>
        {done ? <Check size={10} /> : index}
      </span>
      {label}
    </div>
  );
}

function AgentStep({
  agents, selected, onSelect,
}: {
  agents: AgentDescriptor[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  if (!agents.length) {
    return (
      <div className="p-6 rounded-xl border border-dashed border-edge text-center">
        <Bot size={20} className="text-muted mx-auto mb-2" />
        <div className="text-[13px] font-semibold text-secondary">No agents found</div>
        <div className="text-[12px] text-muted mt-1">
          Drop a markdown file in <code className="font-mono bg-surface-2 px-1 rounded">.claude/agents/</code> to define one.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Bot size={14} className="text-brand" />
        <h3 className="text-[14px] font-semibold text-primary">Pick an agent</h3>
      </div>
      <p className="text-[12.5px] text-muted mb-4">
        The agent runs as the planner for this goal. Its skills and voice shape every task it creates.
      </p>
      <div className="space-y-2">
        {agents.map(a => (
          <label
            key={a.name}
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
              selected === a.name ? 'border-brand/40 bg-brand/5' : 'border-edge hover:border-brand/20 hover:bg-surface-1/40'
            }`}
          >
            <input
              type="radio"
              name="agent"
              checked={selected === a.name}
              onChange={() => onSelect(a.name)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-primary">{a.name}</span>
                {a.model && <span className="text-[10px] font-mono text-muted bg-surface-1 px-1.5 py-0.5 rounded">{a.model}</span>}
              </div>
              {a.description && <div className="text-[12px] text-muted mt-1">{a.description}</div>}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function ContextStep({
  mcpList, mcpIds, onToggleMcp, contextMd, onChangeContext,
}: {
  mcpList: McpConnection[];
  mcpIds: string[];
  onToggleMcp: (id: string) => void;
  contextMd: string;
  onChangeContext: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Plug size={14} className="text-brand" />
          <h3 className="text-[14px] font-semibold text-primary">MCP connections</h3>
        </div>
        <p className="text-[12.5px] text-muted mb-3">
          MCPs the planner and task agents can use. Optional.
        </p>
        {mcpList.length === 0 ? (
          <div className="p-3 rounded-md bg-surface-1 text-[12px] text-muted">
            No MCP servers configured. Add some from the MCP page, then re-open this wizard.
          </div>
        ) : (
          <div className="space-y-1.5">
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
                  onChange={() => onToggleMcp(m.id)}
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

      <section>
        <div className="flex items-center gap-2 mb-3">
          <FileText size={14} className="text-brand" />
          <h3 className="text-[14px] font-semibold text-primary">Context</h3>
        </div>
        <p className="text-[12.5px] text-muted mb-3">
          Free-form markdown the planner and every task subagent will read at the start of every run. Use it to pin priorities, constraints, tone, or ongoing campaigns.
        </p>
        <textarea
          value={contextMd}
          onChange={e => onChangeContext(e.target.value)}
          placeholder={`e.g.

# Q2 SEO focus
- Ship 3 comparison posts per week (apollo alt, clay alt, instantly alt, etc.)
- Skip directory submissions for now — campaign is done
- LinkedIn posts only, no X threads this quarter
- Voice: sharper, more technical — indie-hacker audience`}
          rows={12}
          className="w-full px-3 py-2.5 bg-white border border-edge rounded-lg text-[12.5px] font-mono leading-relaxed focus:outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/10 resize-y"
        />
        <div className="text-[11px] text-muted mt-2">
          Length: {contextMd.length} chars. Tip: this embeds into every task's payload, so the executor and subagents always see it.
        </div>
      </section>
    </div>
  );
}
