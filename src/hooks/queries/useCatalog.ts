import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  fetchCatalogMcps, fetchCatalogMcp, startInstallCatalogMcp,
  fetchCatalogSkills, fetchCatalogSkill,
  startInstallCatalogSkill, fetchInstallJobState,
  type ListCatalogMcpParams, type ListCatalogSkillParams,
  type InstallJobLine, type InstallJobState,
} from '../../api/client';

const MCP_KEY = ['catalog', 'mcps'] as const;
const SKILL_KEY = ['catalog', 'skills'] as const;

export function useCatalogMcps(params: ListCatalogMcpParams) {
  return useQuery({
    queryKey: [...MCP_KEY, params],
    queryFn: () => fetchCatalogMcps(params),
    staleTime: 60_000,
  });
}

export function useCatalogMcp(qualifiedName: string | null) {
  return useQuery({
    queryKey: [...MCP_KEY, 'entry', qualifiedName],
    queryFn: () => fetchCatalogMcp(qualifiedName as string),
    enabled: !!qualifiedName,
  });
}

export function useCatalogSkills(params: ListCatalogSkillParams) {
  return useQuery({
    queryKey: [...SKILL_KEY, params],
    queryFn: () => fetchCatalogSkills(params),
    staleTime: 60_000,
  });
}

export function useCatalogSkill(key: { owner: string; repo: string; slug: string } | null) {
  return useQuery({
    queryKey: [...SKILL_KEY, 'entry', key],
    queryFn: () => fetchCatalogSkill(key!.owner, key!.repo, key!.slug),
    enabled: !!key,
  });
}

// ---------------------------------------------------------------------------
// Install job — shared polling machinery for MCP + Skill installs.
//
// Polling (~700ms) rather than SSE keeps one code path across HTTP and IPC.
// The job contains "auth_url" lines when OAuth is required; the UI can pick
// the latest one to render a "Sign in" button even if the browser auto-open
// was blocked.
// ---------------------------------------------------------------------------

export interface InstallJobHandle {
  start: (...args: unknown[]) => Promise<void>;
  reset: () => void;
  jobId: string | null;
  lines: InstallJobLine[];
  done: boolean;
  exitCode: number | null;
  running: boolean;
  error: string | null;
  authUrl: string | null;   // latest `auth_url` line, if any
}

type StarterFn = (...args: unknown[]) => Promise<{ jobId: string }>;

function useInstallJob(opts: {
  starter: StarterFn;
  invalidateKeys: readonly (readonly unknown[])[];
  onDone?: (state: InstallJobState) => void;
}): InstallJobHandle {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<InstallJobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      try {
        const s = await fetchInstallJobState(jobId);
        if (cancelled) return;
        setState(s);
        if (s.done) {
          invalidateAll(qc, opts.invalidateKeys);
          onDoneRef.current?.(s);
          return;
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
        return;
      }
      t = setTimeout(tick, 700);
    };
    tick();
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [jobId, qc, opts.invalidateKeys]);

  const start = useCallback(async (...args: unknown[]): Promise<void> => {
    setError(null);
    setState(null);
    try {
      const { jobId: id } = await opts.starter(...args);
      setJobId(id);
    } catch (err) {
      setError((err as Error).message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.starter]);

  const reset = useCallback((): void => {
    setJobId(null);
    setState(null);
    setError(null);
  }, []);

  const lines = (state?.lines ?? []) as InstallJobLine[];
  const authUrl = lastAuthUrl(lines);

  return {
    start,
    reset,
    jobId,
    lines,
    done: state?.done ?? false,
    exitCode: state?.exitCode ?? null,
    running: !!jobId && !(state?.done ?? false),
    error: error ?? state?.error ?? null,
    authUrl,
  };
}

function invalidateAll(qc: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const key of keys) qc.invalidateQueries({ queryKey: key as unknown[] });
}

function lastAuthUrl(lines: InstallJobLine[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].stream === 'auth_url') return lines[i].line;
  }
  return null;
}

/** MCP install — args: (qualifiedName, config). */
export function useInstallCatalogMcp(opts?: { onDone?: (s: InstallJobState) => void }): {
  start: (qualifiedName: string, config?: Record<string, unknown>) => Promise<void>;
} & Omit<InstallJobHandle, 'start'> {
  const handle = useInstallJob({
    starter: (qualifiedName, config) => startInstallCatalogMcp(qualifiedName as string, (config as Record<string, unknown>) ?? {}),
    invalidateKeys: [MCP_KEY, ['mcp-connections']],
    onDone: opts?.onDone,
  });
  return {
    ...handle,
    start: (qualifiedName, config) => handle.start(qualifiedName, config ?? {}),
  };
}

/** Skill install — args: (owner, repo, slug). */
export function useInstallCatalogSkill(opts?: { onDone?: (s: InstallJobState) => void }): {
  start: (owner: string, repo: string, slug: string) => Promise<void>;
} & Omit<InstallJobHandle, 'start'> {
  const handle = useInstallJob({
    starter: (o, r, s) => startInstallCatalogSkill(o as string, r as string, s as string),
    invalidateKeys: [SKILL_KEY, ['skills']],
    onDone: opts?.onDone,
  });
  return {
    ...handle,
    start: (owner, repo, slug) => handle.start(owner, repo, slug),
  };
}
