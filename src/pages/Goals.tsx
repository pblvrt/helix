import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trash2, Loader2, Clock, CheckCircle, AlertCircle,
  Target, Crosshair, ArrowRight, ChevronDown, ChevronUp, Bot,
} from 'lucide-react';
import { type Goal } from '../api/client';
import { useGoals, useDeleteGoal } from '../hooks/queries/useGoals';
import NewGoalWizard from './goal/NewGoalWizard';

export default function Goals() {
  const navigate = useNavigate();
  const { data: goals, isLoading: loading } = useGoals();
  const deleteMutation = useDeleteGoal();

  const [title, setTitle] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const canContinue = !!title.trim();

  function handleContinue() {
    if (!canContinue) return;
    setWizardOpen(true);
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteMutation.mutateAsync(id);
  }

  if (loading && !goals) {
    return (
      <div className="page-full flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  const all = goals || [];
  const active = all.filter(g => g.status === 'active' || g.status === 'planning');
  const done = all.filter(g => g.status !== 'active' && g.status !== 'planning');

  return (
    <div className="page-narrow">
      <div className="text-center mt-8 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-brand-light flex items-center justify-center mx-auto mb-4">
          <Crosshair size={24} className="text-brand" />
        </div>
        <h1 className="text-[28px] font-bold tracking-tight mb-1">Plan → Execute.</h1>
        <p className="text-[14px] text-muted">Describe the goal. The agent plans tasks onto the board; the executor runs them.</p>
      </div>

      <div className="max-w-[600px] mx-auto mb-10">
        <div className="bg-white border border-edge rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04)] focus-within:border-brand/40 focus-within:shadow-[0_2px_12px_rgba(99,102,241,0.1)] transition-all">
          <textarea
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleContinue(); }
            }}
            placeholder="Q2 SEO push — ship 3 comparison posts per week (apollo, clay, instantly alternatives). No reddit for now."
            rows={3}
            className="w-full px-5 py-4 text-[14px] leading-relaxed bg-transparent focus:outline-none placeholder:text-muted/60 resize-none"
          />
          <div className="px-4 pb-3 flex items-center gap-2 justify-between">
            <button
              onClick={() => setShowMore(s => !s)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted hover:text-secondary hover:bg-surface-1 transition-colors"
            >
              {showMore ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {showMore ? 'Hide' : 'Set target count'}
            </button>
            <button
              onClick={handleContinue}
              disabled={!canContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-[13px] font-medium hover:bg-brand/90 disabled:opacity-50"
            >
              Continue <ArrowRight size={13} />
            </button>
          </div>
          {showMore && (
            <div className="px-5 pb-4 border-t border-edge pt-3">
              <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Target count (optional)</label>
              <input
                type="number"
                min={1}
                value={targetCount}
                onChange={e => setTargetCount(e.target.value)}
                placeholder="e.g. 20 — leave blank for open-ended"
                className="w-full mt-1.5 px-3 py-1.5 border border-edge rounded-md text-[13px] bg-white focus:outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/10"
              />
            </div>
          )}
        </div>
      </div>

      {active.length > 0 && (
        <div className="mb-8">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3 px-1">Active</div>
          <div className="space-y-3">
            {active.map(g => <GoalRow key={g.id} goal={g} onClick={() => navigate(`/goals/${g.id}`)} onDelete={handleDelete} />)}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3 px-1">Past</div>
          <div className="space-y-2">
            {done.map(g => <GoalRow key={g.id} goal={g} onClick={() => navigate(`/goals/${g.id}`)} onDelete={handleDelete} />)}
          </div>
        </div>
      )}

      {wizardOpen && (
        <NewGoalWizard
          title={title}
          targetCount={targetCount}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

function GoalRow({
  goal, onClick, onDelete,
}: {
  goal: Goal;
  onClick: () => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}) {
  const isActive = goal.status === 'active' || goal.status === 'planning';
  const isCompleted = goal.status === 'completed';
  const isFailed = goal.status === 'failed';
  const progress = goal.targetCount
    ? Math.min(100, Math.round((goal.currentCount / goal.targetCount) * 100))
    : null;

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer px-5 py-4 bg-white border rounded-xl transition ${
        isActive ? 'border-brand/30 shadow-[0_2px_12px_rgba(99,102,241,0.08)]' : 'border-edge hover:border-brand/20'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
          isActive ? 'bg-brand-light' : isCompleted ? 'bg-emerald-50' : isFailed ? 'bg-red-50' : 'bg-surface-2'
        }`}>
          {isActive ? <Loader2 size={16} className="animate-spin text-brand" /> :
           isCompleted ? <CheckCircle size={16} className="text-emerald-500" /> :
           isFailed ? <AlertCircle size={16} className="text-red-400" /> :
           <Target size={16} className="text-muted" />}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-primary mb-1 truncate">{goal.title}</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
              isActive ? 'text-brand bg-brand-light' :
              isCompleted ? 'text-emerald-700 bg-emerald-50' :
              isFailed ? 'text-red-600 bg-red-50' :
              'text-muted bg-surface-2'
            }`}>
              {goal.status === 'planning' ? 'Planning'
                : goal.status === 'active' ? 'Running'
                : goal.status === 'completed' ? 'Done'
                : goal.status}
            </span>

            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-muted bg-surface-1 px-1.5 py-0.5 rounded">
              <Bot size={10} /> {goal.agentType || 'seo'}
            </span>

            {goal.targetCount ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-primary">{goal.currentCount}/{goal.targetCount}</span>
                <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-emerald-500' : 'bg-brand'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : goal.currentCount > 0 ? (
              <span className="text-[12px] text-muted">{goal.currentCount}</span>
            ) : null}

            {goal.cronExpression && (
              <span className="flex items-center gap-1 text-[10px] text-muted">
                <Clock size={9} /> Recurring
              </span>
            )}
          </div>
        </div>

        <button
          onClick={e => onDelete(goal.id, e)}
          className="p-2 rounded-lg text-muted hover:text-red-500 hover:bg-red-50 transition-all shrink-0"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
