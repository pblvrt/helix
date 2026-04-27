import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen, Plus, Save, Trash2, Loader2, Check, X, Search,
} from 'lucide-react';
import {
  useKnowledge, useCreateKnowledge, useUpdateKnowledge, useDeleteKnowledge,
} from '../hooks/queries/useKnowledge';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import type { Knowledge, KnowledgeContentType } from '../api/client';

const CONTENT_TYPES: KnowledgeContentType[] = ['markdown', 'json', 'text'];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

interface EditorState {
  slug: string;
  title: string;
  collection: string;
  tagsInput: string;
  content: string;
  contentType: KnowledgeContentType;
  slugTouched: boolean;
}

const EMPTY_EDITOR: EditorState = {
  slug: '',
  title: '',
  collection: 'general',
  tagsInput: '',
  content: '',
  contentType: 'markdown',
  slugTouched: false,
};

function editorFromEntry(entry: Knowledge): EditorState {
  return {
    slug: entry.slug,
    title: entry.title,
    collection: entry.collection,
    tagsInput: entry.tags.join(', '),
    content: entry.content,
    contentType: entry.contentType,
    slugTouched: true,
  };
}

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export default function Knowledge() {
  const { data: entries, isLoading } = useKnowledge();
  const createMut = useCreateKnowledge();
  const updateMut = useUpdateKnowledge();
  const deleteMut = useDeleteKnowledge();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [search, setSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  const selected = useMemo(
    () => entries?.find(e => e.slug === selectedSlug) || null,
    [entries, selectedSlug],
  );

  // Auto-select first entry on first load
  useEffect(() => {
    if (selectedSlug || creating || !entries?.length) return;
    setSelectedSlug(entries[0].slug);
  }, [entries, selectedSlug, creating]);

  // Load selected entry into editor
  useEffect(() => {
    if (creating) return;
    setErrorMsg(null);
    setEditor(selected ? editorFromEntry(selected) : EMPTY_EDITOR);
  }, [selected, creating]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(e =>
      e.title.toLowerCase().includes(needle) ||
      e.slug.toLowerCase().includes(needle) ||
      e.collection.toLowerCase().includes(needle) ||
      e.tags.some(t => t.toLowerCase().includes(needle)),
    );
  }, [entries, search]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, Knowledge[]>();
    for (const entry of filteredEntries) {
      if (!groups.has(entry.collection)) groups.set(entry.collection, []);
      groups.get(entry.collection)!.push(entry);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEntries]);

  const knownCollections = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries || []) set.add(e.collection);
    set.add('general');
    return [...set].sort();
  }, [entries]);

  const parsedTags = useMemo(() => parseTags(editor.tagsInput), [editor.tagsInput]);

  const dirty = creating
    ? !!(editor.slug.trim() && editor.title.trim())
    : selected
      ? (
        editor.slug !== selected.slug ||
        editor.title !== selected.title ||
        editor.collection !== selected.collection ||
        !tagsEqual(parsedTags, selected.tags) ||
        editor.content !== selected.content ||
        editor.contentType !== selected.contentType
      )
      : false;

  const handleNew = useCallback(() => {
    setCreating(true);
    setSelectedSlug(null);
    setEditor(EMPTY_EDITOR);
    setErrorMsg(null);
  }, []);

  const handleCancelNew = useCallback(() => {
    setCreating(false);
    setErrorMsg(null);
    if (entries?.length) setSelectedSlug(entries[0].slug);
  }, [entries]);

  const handleSave = useCallback(async () => {
    const slug = editor.slug.trim();
    const title = editor.title.trim();
    if (!slug || !title) return;
    setErrorMsg(null);
    try {
      if (creating) {
        const created = await createMut.mutateAsync({
          slug,
          title,
          collection: editor.collection.trim() || 'general',
          tags: parsedTags,
          content: editor.content,
          contentType: editor.contentType,
        });
        setCreating(false);
        setSelectedSlug(created.slug);
      } else if (selected) {
        const updated = await updateMut.mutateAsync({
          slug: selected.slug,
          patch: {
            slug,
            title,
            collection: editor.collection.trim() || 'general',
            tags: parsedTags,
            content: editor.content,
            contentType: editor.contentType,
          },
        });
        if (updated.slug !== selected.slug) setSelectedSlug(updated.slug);
      }
      setSavedJustNow(true);
      setTimeout(() => setSavedJustNow(false), 1500);
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to save');
    }
  }, [creating, selected, editor, parsedTags, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!confirm(`Delete knowledge entry “${selected.title}”?`)) return;
    await deleteMut.mutateAsync(selected.slug);
    setSelectedSlug(null);
  }, [selected, deleteMut]);

  useKeyboardShortcut([
    { key: 's', modifiers: ['meta'], handler: handleSave, ignoreInputs: false },
    { key: 's', modifiers: ['ctrl'], handler: handleSave, ignoreInputs: false },
  ], [handleSave]);

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="flex items-center gap-3 mt-6 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center">
          <BookOpen size={18} className="text-brand" />
        </div>
        <div>
          <h1 className="text-[20px] font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-[12px] text-muted">
            Facts, voice guides, and seed data agents read at runtime. Group by collection, tag, and edit.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-6">
        {/* Left: list */}
        <div>
          <button onClick={handleNew} className="btn btn-primary w-full gap-1.5 mb-3 text-[12px]">
            <Plus size={13} /> New entry
          </button>

          <div className="relative mb-3">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title, slug, tag…"
              className="input text-[12px] w-full pl-8"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="animate-spin text-muted" />
            </div>
          ) : (
            <div className="space-y-4">
              {creating && (
                <div className="px-3 py-2 rounded-lg text-[12px] bg-brand-light text-brand font-semibold flex items-center gap-2">
                  <Plus size={10} /> New entry
                </div>
              )}
              {groupedEntries.map(([collection, items]) => (
                <div key={collection}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted px-1 mb-1">
                    {collection} <span className="text-muted/60">({items.length})</span>
                  </div>
                  <div className="space-y-1">
                    {items.map(entry => (
                      <button
                        key={entry.slug}
                        onClick={() => { setCreating(false); setSelectedSlug(entry.slug); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all ${
                          entry.slug === selectedSlug && !creating
                            ? 'bg-brand-light text-brand font-semibold'
                            : 'text-secondary hover:bg-surface-1'
                        }`}
                      >
                        <span className="truncate block">{entry.title}</span>
                        <span className="text-[10px] text-muted font-mono truncate block">{entry.slug}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!groupedEntries.length && !creating && (
                <div className="text-[12px] text-muted text-center py-6">
                  {search ? 'No entries match your search.' : 'No knowledge entries yet.'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: editor */}
        <div>
          {(selected || creating) ? (
            <div className="card p-5">
              <input
                value={editor.title}
                onChange={e => {
                  const title = e.target.value;
                  setEditor(prev => ({
                    ...prev,
                    title,
                    slug: prev.slugTouched ? prev.slug : slugify(title),
                  }));
                }}
                placeholder="Entry title (e.g. Voice — LinkedIn)"
                className="input text-[15px] font-semibold w-full mb-3"
              />

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Slug</label>
                  <input
                    value={editor.slug}
                    onChange={e => setEditor(prev => ({ ...prev, slug: e.target.value, slugTouched: true }))}
                    placeholder="voice-linkedin"
                    className="input input-mono text-[12px] w-full mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Collection</label>
                  <input
                    list="knowledge-collections"
                    value={editor.collection}
                    onChange={e => setEditor(prev => ({ ...prev, collection: e.target.value }))}
                    placeholder="voice, product, seed-list…"
                    className="input text-[12px] w-full mt-1"
                  />
                  <datalist id="knowledge-collections">
                    {knownCollections.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-[1fr_160px] gap-3 mb-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Tags</label>
                  <input
                    value={editor.tagsInput}
                    onChange={e => setEditor(prev => ({ ...prev, tagsInput: e.target.value }))}
                    placeholder="linkedin, 280-char (comma-separated)"
                    className="input text-[12px] w-full mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Type</label>
                  <select
                    value={editor.contentType}
                    onChange={e => setEditor(prev => ({ ...prev, contentType: e.target.value as KnowledgeContentType }))}
                    className="input text-[12px] w-full mt-1"
                  >
                    {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Content</label>
              <textarea
                value={editor.content}
                onChange={e => setEditor(prev => ({ ...prev, content: e.target.value }))}
                spellCheck={false}
                placeholder={editor.contentType === 'json' ? '{\n  \n}' : '# Start writing…'}
                className="input input-mono w-full text-[12px] leading-relaxed resize-none min-h-[360px] mt-1"
              />

              {errorMsg && <p className="mt-2 text-[11px] text-red-500">{errorMsg}</p>}

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!editor.slug.trim() || !editor.title.trim() || !dirty || saving}
                    className="btn btn-primary gap-1.5 text-[12px]"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> :
                     savedJustNow ? <Check size={12} /> :
                     <Save size={12} />}
                    {savedJustNow ? 'Saved' : creating ? 'Create' : 'Save'}
                    {!savedJustNow && <span className="text-[10px] opacity-60 ml-1">⌘S</span>}
                  </button>
                  {creating && (
                    <button onClick={handleCancelNew} className="btn btn-ghost gap-1.5 text-[12px]">
                      <X size={12} /> Cancel
                    </button>
                  )}
                </div>
                {!creating && selected && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteMut.isPending}
                    className="btn btn-ghost gap-1.5 text-[12px] text-red-500 hover:bg-red-50"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="card p-10 text-center">
              <p className="text-[13px] text-muted">Select an entry, or add a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
