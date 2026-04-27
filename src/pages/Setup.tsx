import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, ArrowRight, Settings, Download, Check, Terminal, Zap, Book,
} from 'lucide-react';
import { fetchUserConfig, saveUserConfig, type UserConfig } from '../api/client';
import { DEFAULT_USER_CONFIG } from '../../backend/core/types';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

interface SetupProps {
  onComplete?: () => void;
}

export default function Setup({ onComplete }: SetupProps) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [version, setVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<'checking' | 'up-to-date' | 'available' | 'ready'>('checking');

  useEffect(() => {
    fetchUserConfig()
      .then(setConfig)
      .catch(() => setConfig({ ...DEFAULT_USER_CONFIG }))
      .finally(() => setLoading(false));

    if (isElectron) {
      window.electronAPI!.invoke('app:version').then((v: unknown) => setVersion(v as string)).catch(() => {});
      window.electronAPI!.invoke('app:check-update').then((s: unknown) => {
        const status = s as string;
        if (status === 'update-available') setUpdateStatus('available');
        else if (status === 'update-downloaded') setUpdateStatus('ready');
        else setUpdateStatus('up-to-date');
      }).catch(() => setUpdateStatus('up-to-date'));
    } else {
      setUpdateStatus('up-to-date');
    }
  }, []);

  const handleComplete = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const final: UserConfig = {
        ...config,
        onboardingCompleted: true,
        updatedAt: new Date().toISOString(),
      };
      if (!final.createdAt) final.createdAt = final.updatedAt;
      await saveUserConfig(final);
      setConfig(final);
      onComplete?.();
      navigate('/');
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  }, [config, navigate, onComplete]);

  if (loading) {
    return (
      <div className="page-full flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted" />
      </div>
    );
  }

  const isFirstSetup = !config?.onboardingCompleted;

  return (
    <div className="max-w-[640px] mx-auto mt-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center">
          <Settings size={18} className="text-muted" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Setup</h1>
          <p className="text-[13px] text-muted">Welcome to the agent queue template</p>
        </div>
      </div>

      <div className="mb-8">
        <div className="section-label mb-3 px-1">App Updates</div>
        <div className="card px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand-light flex items-center justify-center">
                <Download size={16} className="text-brand" />
              </div>
              <div>
                <span className="text-[14px] font-semibold block">Agent Queue</span>
                <span className="text-[12px] text-muted">
                  {version ? `v${version}` : isElectron ? 'Loading...' : 'Web mode'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {updateStatus === 'ready' ? (
                <button onClick={() => window.electronAPI?.invoke('app:install-update')} className="btn btn-primary btn-sm">
                  Restart to update
                </button>
              ) : updateStatus === 'available' ? (
                <span className="flex items-center gap-1.5 text-[11px] text-amber-600 font-medium">
                  <Download size={12} /> Downloading update...
                </span>
              ) : updateStatus === 'checking' ? (
                <span className="text-[11px] text-muted">Checking...</span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-medium">
                  <Check size={12} /> Up to date
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="section-label mb-3 px-1">Getting started</div>
        <div className="space-y-2">
          <InfoCard
            icon={Terminal}
            title="Drop a command"
            body={<>Create <code className="bg-surface-2 px-1 py-0.5 rounded text-[11px] font-mono">.claude/commands/&lt;name&gt;.md</code> — it's auto-discovered as a runnable command.</>}
          />
          <InfoCard
            icon={Zap}
            title="Queue a goal"
            body={<>Visit <strong>Goals</strong>, describe what the agent should do, and hit Start. The runner spawns <code className="bg-surface-2 px-1 py-0.5 rounded text-[11px] font-mono">claude -p</code> in a subprocess.</>}
          />
          <InfoCard
            icon={Book}
            title="Read PATTERNS.md"
            body={<>Documents the module/controller pattern, IPC vs HTTP adapters, and how to add your own feature module end-to-end.</>}
          />
        </div>
      </div>

      {isFirstSetup && (
        <div className="flex justify-end pt-4 border-t border-edge mb-8">
          <button
            onClick={handleComplete}
            disabled={saving}
            className="btn btn-primary text-[13px] px-6"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            Get started
          </button>
        </div>
      )}
    </div>
  );
}

function InfoCard({
  icon: Icon, title, body,
}: {
  icon: React.ElementType;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="card px-5 py-4 flex items-start gap-4">
      <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
        <Icon size={15} className="text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold mb-0.5">{title}</div>
        <div className="text-[12px] text-muted leading-relaxed">{body}</div>
      </div>
    </div>
  );
}
