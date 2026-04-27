import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plug, Plus, Save, Trash2, Loader2, Check, X, Search, Download, ExternalLink, AlertCircle, LogIn,
} from 'lucide-react';
import {
  useMcpConnections, useCreateMcpConnection, useUpdateMcpConnection, useDeleteMcpConnection,
} from '../hooks/queries/useMcp';
import { useCatalogMcps, useCatalogMcp, useInstallCatalogMcp } from '../hooks/queries/useCatalog';
import { Modal } from './Skills';
import type { CatalogMcp, CatalogMcpConnection } from '../api/client';

function openExternal(url: string): void {
  const w = window as unknown as { electronAPI?: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> } };
  if (w.electronAPI?.invoke) void w.electronAPI.invoke('shell:open-external', url);
  else window.open(url, '_blank', 'noopener');
}

type Tab = 'browse' | 'installed';

export default function McpConnections() {
  const [tab, setTab] = useState<Tab>('installed');

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-center gap-3 mt-6 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center">
          <Plug size={18} className="text-brand" />
        </div>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold tracking-tight">MCP Servers</h1>
          <p className="text-[12px] text-muted">
            Browse servers from Smithery, install with one click. Manage your library on the Installed tab.
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
// Browse tab — live from Smithery
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
  const { data, isLoading, isFetching, error } = useCatalogMcps(params);
  const [installTarget, setInstallTarget] = useState<CatalogMcp | null>(null);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search MCP servers…"
            className="input pl-9 text-[13px] w-full"
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={<AlertCircle size={32} className="text-red-500" />}
          title="Smithery registry unreachable"
          hint={(error as Error).message}
        />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-muted" />
        </div>
      ) : !data?.entries.length ? (
        <EmptyState icon={<Search size={32} className="text-muted" />} title="No servers match that search." />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {data.entries.map(entry => (
              <CatalogMcpCard
                key={entry.qualifiedName}
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
        <InstallMcpModal
          entry={installTarget}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}

function CatalogMcpCard({ entry, onInstall }: { entry: CatalogMcp; onInstall: () => void }) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        {entry.iconUrl ? (
          <img
            src={entry.iconUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-lg bg-surface-1 object-cover shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-surface-1 flex items-center justify-center shrink-0">
            <Plug size={15} className="text-muted" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold truncate">{entry.displayName || entry.qualifiedName}</span>
            {entry.verified && <Check size={11} className="text-emerald-500 shrink-0" />}
          </div>
          <div className="text-[10px] font-mono text-muted truncate">{entry.qualifiedName}</div>
        </div>
      </div>

      <p className="text-[12px] text-secondary leading-relaxed line-clamp-2 min-h-[32px]">
        {entry.description || '—'}
      </p>

      <div className="flex items-center gap-3 text-[11px] text-muted">
        {entry.useCount > 0 && <span>{entry.useCount.toLocaleString()} uses</span>}
        {entry.homepage && (
          <a
            href={entry.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-brand transition-colors"
          >
            <ExternalLink size={11} /> homepage
          </a>
        )}
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

interface SchemaProperty {
  type?: string;
  format?: string;
  description?: string;
  default?: unknown;
}

function parseConfigSchema(schema: Record<string, unknown> | undefined):
  { fields: Array<{ key: string; required: boolean; prop: SchemaProperty }>; unsupported: boolean }
{
  if (!schema || typeof schema !== 'object') return { fields: [], unsupported: false };
  const properties = (schema.properties as Record<string, SchemaProperty> | undefined) ?? {};
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const fields = Object.entries(properties).map(([key, prop]) => ({
    key,
    required: required.has(key),
    prop,
  }));
  // Anything that has a non-string / object property falls back to raw JSON.
  const unsupported = fields.some(f => f.prop.type && !['string', 'number', 'integer', 'boolean'].includes(f.prop.type));
  return { fields, unsupported };
}

function pickPrimaryConnection(conns: CatalogMcpConnection[] | undefined): CatalogMcpConnection | null {
  if (!conns || !conns.length) return null;
  return conns.find(c => c.type === 'stdio') ?? conns[0];
}

function InstallMcpModal({ entry, onClose }: { entry: CatalogMcp; onClose: () => void }) {
  const { data: detail, isLoading, error } = useCatalogMcp(entry.qualifiedName);
  const installer = useInstallCatalogMcp();

  const connection = pickPrimaryConnection(detail?.connections);
  const { fields, unsupported } = parseConfigSchema(connection?.configSchema);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawJson, setRawJson] = useState('{}');
  const [rawError, setRawError] = useState<string | null>(null);
  const [useRaw, setUseRaw] = useState(false);

  useEffect(() => {
    if (unsupported) setUseRaw(true);
  }, [unsupported]);

  const handleInstall = async (): Promise<void> => {
    let config: Record<string, unknown> = {};
    if (useRaw) {
      try { config = JSON.parse(rawJson || '{}'); }
      catch { setRawError('Invalid JSON'); return; }
      setRawError(null);
    } else {
      for (const f of fields) {
        const v = values[f.key];
        if (v === undefined || v === '') continue;
        if (f.prop.type === 'number' || f.prop.type === 'integer') config[f.key] = Number(v);
        else if (f.prop.type === 'boolean') config[f.key] = v === 'true';
        else config[f.key] = v;
      }
    }
    await installer.start(entry.qualifiedName, config);
  };

  const missingRequired = !useRaw && fields.some(f => f.required && !values[f.key]);
  const isRunning = installer.running || installer.done || installer.jobId !== null;
  const ok = installer.done && installer.exitCode === 0;
  const failed = installer.done && installer.exitCode !== 0;

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center gap-3 mb-3">
        <Download size={16} className="text-brand" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold truncate">
            {isRunning ? 'Installing' : 'Install'} {entry.displayName || entry.qualifiedName}
          </div>
          <div className="text-[11px] font-mono text-muted truncate">{entry.qualifiedName}</div>
        </div>
        <button onClick={onClose} className="btn btn-ghost p-1.5"><X size={14} /></button>
      </div>

      {isRunning ? (
        <InstallProgress
          lines={installer.lines}
          authUrl={installer.authUrl}
          running={installer.running}
          ok={ok}
          failed={failed}
          exitCode={installer.exitCode}
          error={installer.error}
          onClose={onClose}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin text-muted" />
        </div>
      ) : error ? (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-[12px]">
          Failed to load manifest: {(error as Error).message}
        </div>
      ) : !detail || !connection ? (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-[12px]">
          No installable connection available for this server.
        </div>
      ) : (
        <>
          <div className="mb-3 text-[12px] text-secondary">
            Connection type <span className="font-mono font-semibold">{connection.type}</span>
            {connection.command && (
              <>
                {' · '}
                <span className="font-mono">{connection.command} {connection.args?.join(' ')}</span>
              </>
            )}
          </div>

          {connection.type === 'http' && (
            <div className="mb-3 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              Remote MCP. You'll be taken through Smithery's OAuth flow after clicking Install — a browser tab will open for you to sign in to the provider.
            </div>
          )}

          {!useRaw && fields.length > 0 ? (
            <div className="space-y-3 max-h-[320px] overflow-auto pr-1">
              {fields.map(f => {
                const isSecret = f.prop.format === 'password' || /key|token|secret|password/i.test(f.key);
                return (
                  <div key={f.key}>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                      {f.key}
                      {f.required && <span className="text-red-500">*</span>}
                    </label>
                    {f.prop.description && (
                      <p className="text-[11px] text-muted mt-0.5">{f.prop.description}</p>
                    )}
                    {f.prop.type === 'boolean' ? (
                      <select
                        value={values[f.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                        className="input text-[12px] w-full mt-1"
                      >
                        <option value="">—</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        type={isSecret ? 'password' : f.prop.type === 'number' || f.prop.type === 'integer' ? 'number' : 'text'}
                        value={values[f.key] ?? ''}
                        onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                        placeholder={f.prop.default != null ? String(f.prop.default) : ''}
                        className="input text-[12px] w-full mt-1"
                        autoComplete={isSecret ? 'off' : undefined}
                      />
                    )}
                  </div>
                );
              })}
              {unsupported && (
                <button onClick={() => setUseRaw(true)} className="text-[11px] text-brand hover:underline">
                  Unsupported schema — switch to raw JSON
                </button>
              )}
            </div>
          ) : fields.length === 0 && !useRaw ? (
            <div className="p-3 rounded-lg bg-surface-1 text-[12px] text-secondary">
              {connection.type === 'http' ? 'No local configuration — sign-in happens in your browser.' : 'No configuration required — ready to install.'}
            </div>
          ) : (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">Config (JSON)</label>
              <textarea
                value={rawJson}
                onChange={e => { setRawJson(e.target.value); setRawError(null); }}
                spellCheck={false}
                className="input input-mono w-full text-[11px] leading-relaxed resize-none min-h-[160px] mt-1"
              />
              {rawError && <p className="text-[11px] text-red-500 mt-1">{rawError}</p>}
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn btn-ghost text-[12px]">Cancel</button>
            <button
              onClick={handleInstall}
              disabled={missingRequired}
              className="btn btn-primary gap-1.5 text-[12px]"
            >
              <Download size={12} /> Install
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function InstallProgress({
  lines, authUrl, running, ok, failed, exitCode, error, onClose,
}: {
  lines: Array<{ stream: string; line: string }>;
  authUrl: string | null;
  running: boolean;
  ok: boolean;
  failed: boolean;
  exitCode: number | null;
  error: string | null;
  onClose: () => void;
}) {
  // Auto-open the authorize URL once per modal instance so the user doesn't
  // have to hunt for a button. We also keep the button visible as a fallback.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (authUrl && !opened) {
      openExternal(authUrl);
      setOpened(true);
    }
  }, [authUrl, opened]);

  return (
    <div>
      {authUrl && !ok && !failed && (
        <div className="mb-3 p-3 rounded-lg bg-brand-light border border-brand/20 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-brand">Sign in to authorize</div>
            <div className="text-[11px] text-muted truncate">A browser tab should have opened — if not, use this button.</div>
          </div>
          <button
            onClick={() => openExternal(authUrl)}
            className="btn btn-primary gap-1.5 text-[12px] shrink-0"
          >
            <LogIn size={12} /> Open sign-in
          </button>
        </div>
      )}

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
                    : l.stream === 'auth_url'
                      ? 'text-secondary truncate'
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
          {ok     && <span className="text-emerald-600 flex items-center gap-1"><Check size={12} /> installed</span>}
          {failed && <span className="text-red-600">failed (exit {exitCode})</span>}
        </div>
        <button onClick={onClose} className="btn btn-primary text-[12px]">
          {ok || failed ? 'Close' : 'Hide'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed tab — existing CRUD over mcp_connections
// ---------------------------------------------------------------------------

function InstalledTab() {
  const { data: items, isLoading } = useMcpConnections();
  const createMut = useCreateMcpConnection();
  const updateMut = useUpdateMcpConnection();
  const deleteMut = useDeleteMcpConnection();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [configJson, setConfigJson] = useState('{}');
  const [configError, setConfigError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const [creating, setCreating] = useState(false);

  const selected = items?.find(i => i.id === selectedId) || null;

  useEffect(() => {
    if (selectedId || creating || !items?.length) return;
    setSelectedId(items[0].id);
  }, [items, selectedId, creating]);

  useEffect(() => {
    if (creating) return;
    if (selected) {
      setName(selected.name);
      setUrl(selected.url);
      setConfigJson(JSON.stringify(selected.config || {}, null, 2));
      setConfigError(null);
    } else {
      setName('');
      setUrl('');
      setConfigJson('{}');
      setConfigError(null);
    }
  }, [selected, creating]);

  const parsedConfig = (() => {
    try { return JSON.parse(configJson || '{}'); } catch { return null; }
  })();

  useEffect(() => {
    if (parsedConfig === null) setConfigError('Invalid JSON');
    else setConfigError(null);
  }, [configJson, parsedConfig]);

  const dirty = !creating && selected ? (
    name !== selected.name ||
    url !== selected.url ||
    JSON.stringify(parsedConfig) !== JSON.stringify(selected.config || {})
  ) : creating ? !!name.trim() : false;

  const handleSave = useCallback(async () => {
    if (!name.trim() || parsedConfig === null) return;
    if (creating) {
      const item = await createMut.mutateAsync({ name: name.trim(), url: url.trim(), config: parsedConfig });
      setCreating(false);
      setSelectedId(item.id);
    } else if (selected) {
      await updateMut.mutateAsync({ id: selected.id, data: { name: name.trim(), url: url.trim(), config: parsedConfig } });
    }
    setSavedJustNow(true);
    setTimeout(() => setSavedJustNow(false), 1500);
  }, [creating, name, url, parsedConfig, selected, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!confirm(`Delete MCP connection "${selected.name}"?`)) return;
    await deleteMut.mutateAsync(selected.id);
    setSelectedId(null);
  }, [selected, deleteMut]);

  const handleNew = (): void => {
    setCreating(true);
    setSelectedId(null);
    setName('');
    setUrl('');
    setConfigJson('{}');
  };

  const handleCancelNew = (): void => {
    setCreating(false);
    if (items?.length) setSelectedId(items[0].id);
  };

  return (
    <div className="grid grid-cols-[260px_1fr] gap-6">
      <div>
        <button onClick={handleNew} className="btn btn-primary w-full gap-1.5 mb-3 text-[12px]">
          <Plus size={13} /> New connection
        </button>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-muted" /></div>
        ) : (
          <div className="space-y-1">
            {items?.map(item => (
              <button
                key={item.id}
                onClick={() => { setCreating(false); setSelectedId(item.id); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all ${
                  item.id === selectedId && !creating
                    ? 'bg-brand-light text-brand font-semibold'
                    : 'text-secondary hover:bg-surface-1'
                }`}
              >
                <span className="truncate block">{item.name}</span>
                {item.url && <span className="text-[10px] text-muted font-mono truncate block">{item.url}</span>}
              </button>
            ))}
            {creating && (
              <div className="px-3 py-2 rounded-lg text-[12px] bg-brand-light text-brand font-semibold flex items-center gap-2">
                <Plus size={10} /> New connection
              </div>
            )}
            {(!items?.length && !creating) && (
              <div className="text-[12px] text-muted text-center py-6">No connections yet.</div>
            )}
          </div>
        )}
      </div>

      <div>
        {(selected || creating) ? (
          <div className="card p-5">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Connection name (e.g. Notion, Slack)"
              className="input text-[15px] font-semibold w-full mb-3"
            />

            <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Server URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://mcp.example.com"
              className="input input-mono text-[12px] w-full mt-1 mb-4"
            />

            <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">Config (JSON)</label>
            <textarea
              value={configJson}
              onChange={e => setConfigJson(e.target.value)}
              spellCheck={false}
              placeholder="{}"
              className="input input-mono w-full text-[11px] leading-relaxed resize-none min-h-[200px] mt-1"
            />
            {configError && <p className="mt-1 text-[11px] text-red-500">{configError}</p>}

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={!name.trim() || !dirty || !!configError || createMut.isPending || updateMut.isPending}
                  className="btn btn-primary gap-1.5 text-[12px]"
                >
                  {createMut.isPending || updateMut.isPending ? <Loader2 size={12} className="animate-spin" /> :
                   savedJustNow ? <Check size={12} /> :
                   <Save size={12} />}
                  {savedJustNow ? 'Saved' : creating ? 'Create' : 'Save'}
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
            <p className="text-[13px] text-muted">Select a connection, or add a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits (duplicated from Skills.tsx for module independence)
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
