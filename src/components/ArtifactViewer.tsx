import { useEffect, useMemo, useState } from 'react';
import {
  X, FileText, Image as ImageIcon, StickyNote, Edit2, Save,
  ExternalLink, Loader2, Check, RotateCcw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TaskArtifact } from '../api/client';
import { readFile, writeFile, openArtifact } from '../api/client';

interface Props {
  artifact: TaskArtifact;
  onClose: () => void;
}

/**
 * In-app viewer for task artifacts. Handles:
 *  - `file`:       markdown / JSON / text — render + edit/save
 *  - `screenshot`: inline image preview
 *  - `url`:        nothing to render in-app; offers external open
 *  - `note`:       text-only label
 */
export default function ArtifactViewer({ artifact, onClose }: Props) {
  const [loading, setLoading] = useState(artifact.kind === 'file' || artifact.kind === 'screenshot');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    path: string; kind: 'text' | 'image'; contentType: string; content: string; modifiedAt: string;
  } | null>(null);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const target = artifact.path || artifact.url || '';
  const isFileArtifact = artifact.kind === 'file' || artifact.kind === 'screenshot';

  useEffect(() => {
    if (!isFileArtifact || !target) return;
    let cancelled = false;
    setLoading(true); setError(null);
    readFile(target)
      .then(res => {
        if (cancelled) return;
        setData(res);
        setDraft(res.kind === 'text' ? res.content : '');
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [target, isFileArtifact]);

  async function handleSave() {
    if (!data || data.kind !== 'text') return;
    setSaving(true); setError(null);
    try {
      const result = await writeFile(data.path, draft);
      setData(result);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
      setMode('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    if (!data || data.kind !== 'text') return;
    setDraft(data.content);
  }

  const dirty = data?.kind === 'text' && draft !== data.content;
  const ext = useMemo(() => {
    const p = data?.path || target;
    const m = p.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : '';
  }, [data, target]);
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const isJson     = ext === 'json' || ext === 'jsonl';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-[1040px] h-[88vh] bg-white rounded-2xl shadow-2xl border border-edge flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-4 py-3 border-b border-edge">
          <KindIcon kind={artifact.kind} />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-primary truncate">{artifact.label}</div>
            <div className="text-[11px] font-mono text-muted truncate">{data?.path || target || '—'}</div>
          </div>

          {data?.kind === 'text' && (
            <div className="flex items-center gap-1 bg-surface-1 rounded-md p-0.5">
              <button
                onClick={() => setMode('preview')}
                className={`px-2.5 py-1 rounded text-[11.5px] font-medium ${mode === 'preview' ? 'bg-white text-primary shadow-sm' : 'text-muted hover:text-secondary'}`}
              >
                Preview
              </button>
              <button
                onClick={() => setMode('edit')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11.5px] font-medium ${mode === 'edit' ? 'bg-white text-primary shadow-sm' : 'text-muted hover:text-secondary'}`}
              >
                <Edit2 size={11} /> Edit
                {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
              </button>
            </div>
          )}

          {artifact.url && (
            <button
              onClick={() => artifact.url && openArtifact(artifact.url)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-1 text-secondary text-[11.5px] hover:bg-surface-2"
            >
              <ExternalLink size={11} /> Open externally
            </button>
          )}

          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-secondary hover:bg-surface-1">
            <X size={16} />
          </button>
        </header>

        {/* Save / status bar (only in edit mode) */}
        {mode === 'edit' && data?.kind === 'text' && (
          <div className="px-4 py-2 flex items-center justify-between bg-amber-50/50 border-b border-edge">
            <div className="text-[11.5px] text-secondary">
              {dirty
                ? <span className="flex items-center gap-1.5 text-amber-700 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Unsaved changes</span>
                : savedAt
                  ? <span className="flex items-center gap-1.5 text-emerald-700 font-medium"><Check size={11} /> Saved</span>
                  : <span className="text-muted">No changes</span>}
            </div>
            <div className="flex items-center gap-1.5">
              {dirty && (
                <button
                  onClick={handleRevert}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] text-muted hover:text-secondary hover:bg-surface-1"
                >
                  <RotateCcw size={11} /> Revert
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium ${dirty ? 'bg-brand text-white hover:bg-brand/90' : 'bg-surface-1 text-muted cursor-not-allowed'} disabled:opacity-50`}
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Save
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-surface-1/30">
          {loading && (
            <div className="h-full flex items-center justify-center">
              <Loader2 size={22} className="animate-spin text-muted" />
            </div>
          )}
          {error && (
            <div className="p-6">
              <div className="max-w-xl mx-auto p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-[13px]">{error}</div>
            </div>
          )}
          {!loading && !error && artifact.kind === 'url' && (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <ExternalLink size={28} className="text-muted mb-3" />
              <div className="text-[14px] text-secondary">External URL</div>
              <div className="text-[12px] font-mono text-muted mt-1 break-all max-w-xl">{artifact.url}</div>
              <button
                onClick={() => artifact.url && openArtifact(artifact.url)}
                className="mt-4 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-[12.5px] font-medium hover:bg-brand/90"
              >
                <ExternalLink size={12} /> Open in browser
              </button>
            </div>
          )}
          {!loading && !error && artifact.kind === 'note' && (
            <div className="h-full flex items-center justify-center text-center p-8">
              <div className="max-w-xl text-[13px] text-secondary bg-white rounded-lg p-4 border border-edge">
                {artifact.label}
              </div>
            </div>
          )}
          {!loading && !error && data?.kind === 'image' && (
            <div className="h-full flex items-center justify-center p-6">
              <img src={data.content} alt={artifact.label} className="max-w-full max-h-full object-contain rounded border border-edge shadow-sm" />
            </div>
          )}
          {!loading && !error && data?.kind === 'text' && mode === 'preview' && (
            <div className="p-6 max-w-[880px] mx-auto">
              {isMarkdown ? (
                <article className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.content}</ReactMarkdown>
                </article>
              ) : isJson ? (
                <pre className="bg-white rounded-lg p-4 border border-edge text-[12px] font-mono whitespace-pre-wrap break-words overflow-x-auto">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(data.content), null, 2); }
                    catch { return data.content; }
                  })()}
                </pre>
              ) : (
                <pre className="bg-white rounded-lg p-4 border border-edge text-[12px] font-mono whitespace-pre-wrap break-words">
                  {data.content}
                </pre>
              )}
            </div>
          )}
          {!loading && !error && data?.kind === 'text' && mode === 'edit' && (
            <div className="p-4 h-full">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                spellCheck={false}
                className="w-full h-full px-4 py-3 rounded-lg border border-edge bg-white text-[12.5px] font-mono leading-relaxed resize-none focus:outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/10"
              />
            </div>
          )}
        </div>

        <footer className="px-4 py-2 border-t border-edge bg-white flex items-center justify-between text-[11px] text-muted">
          <span>
            {data
              ? `${humanSize(data.content.length)}${data.kind === 'text' ? ' · ' + ext.toUpperCase() : ' · ' + data.contentType}`
              : artifact.kind}
          </span>
          {data?.modifiedAt && <span>modified {new Date(data.modifiedAt).toLocaleString()}</span>}
        </footer>
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: TaskArtifact['kind'] }) {
  const Icon = kind === 'screenshot' ? ImageIcon
    : kind === 'note' ? StickyNote
    : kind === 'url' ? ExternalLink
    : FileText;
  return (
    <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
      <Icon size={14} className="text-brand" />
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
