import { useState, useMemo, useEffect } from 'react';
import {
  Sparkles, Search, Download, Loader2, Check, Trash2, ExternalLink, X, Star, AlertCircle,
} from 'lucide-react';
import { useCatalogSkills, useInstallCatalogSkill } from '../hooks/queries/useCatalog';
import { useSkills, useDeleteSkill } from '../hooks/queries/useSkills';
import type { CatalogSkill, Skill } from '../api/client';

type Tab = 'browse' | 'installed';

export default function Skills() {
  const [tab, setTab] = useState<Tab>('browse');

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-center gap-3 mt-6 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center">
          <Sparkles size={18} className="text-brand" />
        </div>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold tracking-tight">Skills</h1>
          <p className="text-[12px] text-muted">
            Browse community skills from skills.sh, install with one click.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-5 border-b border-edge/60">
        <TabButton active={tab === 'browse'} onClick={() => setTab('browse')}>Browse</TabButton>
        <TabButton active={tab === 'installed'} onClick={() => setTab('installed')}>Installed</TabButton>
      </div>

      {tab === 'browse' ? <BrowseTab /> : <InstalledTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-muted hover:text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Browse tab — live from skills.sh
// ---------------------------------------------------------------------------

function BrowseTab() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = useMemo(
    () => ({ q: debounced || undefined, page, pageSize: 24 }),
    [debounced, page],
  );
  const { data, isLoading, isFetching, error } = useCatalogSkills(params);
  const [installTarget, setInstallTarget] = useState<CatalogSkill | null>(null);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="input pl-9 text-[13px] w-full"
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<AlertCircle size={32} className="text-red-500" />}
          title="skills.sh unreachable"
          hint={(error as Error).message}
        />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-muted" />
        </div>
      ) : !data?.entries.length ? (
        <EmptyState icon={<Search size={32} className="text-muted" />} title="No skills match that search." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {data.entries.map(entry => (
              <CatalogSkillCard
                key={`${entry.owner}/${entry.repo}/${entry.slug}`}
                entry={entry}
                onInstall={() => setInstallTarget(entry)}
              />
            ))}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            loading={isFetching}
            onPage={setPage}
          />
        </>
      )}

      {installTarget && (
        <InstallSkillModal
          entry={installTarget}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}

function CatalogSkillCard({ entry, onInstall }: { entry: CatalogSkill; onInstall: () => void }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        {entry.iconUrl ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img
            src={entry.iconUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-lg bg-surface-1 object-cover shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-surface-1 flex items-center justify-center shrink-0">
            <Sparkles size={15} className="text-muted" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate">{entry.displayName || entry.slug}</div>
          <div className="text-[10px] font-mono text-muted truncate">{entry.owner}/{entry.repo}</div>
        </div>
      </div>

      <p className="text-[12px] text-secondary leading-relaxed line-clamp-2 min-h-[32px]">
        {entry.description || '—'}
      </p>

      <div className="flex items-center gap-3 text-[11px] text-muted">
        {entry.githubStars != null && (
          <span className="flex items-center gap-1">
            <Star size={11} strokeWidth={1.6} /> {entry.githubStars}
          </span>
        )}
        <a
          href={`https://github.com/${entry.owner}/${entry.repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-brand transition-colors"
        >
          <ExternalLink size={11} /> source
        </a>
      </div>

      {entry.installed ? (
        <button disabled className="btn btn-ghost gap-1.5 text-[12px] text-emerald-600 cursor-default">
          <Check size={12} /> Installed
        </button>
      ) : (
        <button onClick={onInstall} className="btn btn-primary gap-1.5 text-[12px]">
          <Download size={12} /> Install
        </button>
      )}
    </div>
  );
}

function InstallSkillModal({ entry, onClose }: { entry: CatalogSkill; onClose: () => void }) {
  const installer = useInstallCatalogSkill({ onDone: () => {} });
  const { start, lines, running, done, exitCode, error } = installer;
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    setStarted(true);
    start(entry.owner, entry.repo, entry.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ok = done && exitCode === 0;
  const failed = done && exitCode !== 0;

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center gap-3 mb-3">
        <Download size={16} className="text-brand" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold truncate">
            Installing {entry.displayName || entry.slug}
          </div>
          <div className="text-[11px] font-mono text-muted truncate">
            {entry.owner}/{entry.repo}/{entry.slug}
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost p-1.5">
          <X size={14} />
        </button>
      </div>

      <div className="bg-surface-1 rounded-lg border border-edge/60 p-3 font-mono text-[11px] leading-relaxed max-h-[280px] overflow-auto">
        {lines.length === 0 && !error ? (
          <div className="text-muted flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> starting…
          </div>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              className={
                l.stream === 'stderr'
                  ? 'text-red-600'
                  : l.stream === 'status'
                    ? 'text-brand'
                    : 'text-secondary'
              }
            >
              {l.line}
            </div>
          ))
        )}
        {error && <div className="text-red-600">{error}</div>}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="text-[12px]">
          {running && <span className="text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> running…</span>}
          {ok && <span className="text-emerald-600 flex items-center gap-1"><Check size={12} /> installed</span>}
          {failed && <span className="text-red-600">failed (exit {exitCode})</span>}
        </div>
        <button onClick={onClose} className="btn btn-primary text-[12px]">
          {done ? 'Close' : 'Hide'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Installed tab — .claude/skills/*/SKILL.md
// ---------------------------------------------------------------------------

function InstalledTab() {
  const { data: skills, isLoading } = useSkills();
  const deleteMut = useDeleteSkill();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const handleUninstall = async (skill: Skill): Promise<void> => {
    if (!confirm(`Uninstall skill "${skill.name}"?\n\nThis removes .claude/skills/${skill.slug}/.`)) return;
    try {
      await deleteMut.mutateAsync(skill.slug);
    } catch (err) {
      alert(`Uninstall failed: ${(err as Error).message}`);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-muted" /></div>;
  }
  if (!skills?.length) {
    return (
      <EmptyState
        icon={<Sparkles size={32} className="text-muted" />}
        title="No skills installed yet."
        hint="Switch to Browse to install your first one."
      />
    );
  }

  return (
    <div className="space-y-2">
      {skills.map(skill => {
        const expanded = expandedSlug === skill.slug;
        return (
          <div key={skill.slug} className="card p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand-light flex items-center justify-center shrink-0">
                <Sparkles size={15} className="text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold">{skill.name}</span>
                  <span className="text-[10px] font-mono text-muted">{skill.slug}</span>
                </div>
                <p className="text-[12px] text-secondary leading-relaxed mt-0.5">
                  {skill.description}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setExpandedSlug(expanded ? null : skill.slug)}
                  className="btn btn-ghost text-[11px]"
                >
                  {expanded ? 'Hide' : 'View'}
                </button>
                <button
                  onClick={() => handleUninstall(skill)}
                  disabled={deleteMut.isPending}
                  className="btn btn-ghost gap-1 text-[11px] text-red-500 hover:bg-red-50"
                >
                  <Trash2 size={11} /> Uninstall
                </button>
              </div>
            </div>
            {expanded && (
              <pre className="mt-3 bg-surface-1 border border-edge/60 rounded-lg p-3 font-mono text-[11px] leading-relaxed overflow-auto max-h-[420px] whitespace-pre-wrap">
                {skill.body}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="card p-10 flex flex-col items-center justify-center text-center">
      {icon}
      <p className="text-[13px] text-secondary mt-3">{title}</p>
      {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

function Pagination({
  page, totalPages, loading, onPage,
}: { page: number; totalPages: number; loading: boolean; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-6 text-[12px]">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1 || loading}
        className="btn btn-ghost text-[12px]"
      >
        ← Prev
      </button>
      <span className="text-muted">
        Page {page} of {totalPages}
        {loading && <Loader2 size={11} className="animate-spin inline-block ml-2" />}
      </span>
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages || loading}
        className="btn btn-ghost text-[12px]"
      >
        Next →
      </button>
    </div>
  );
}

export function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] p-5"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
