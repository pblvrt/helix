import fs from 'fs';
import { execSync } from 'child_process';
import type { VerificationSpec } from '../../core/types.js';

export interface VerificationResult {
  ok: boolean;
  reason: string;
  requiresHuman: boolean;   // true for 'manual' or absent spec
}

function pass(reason = 'ok'): VerificationResult {
  return { ok: true, reason, requiresHuman: false };
}

function fail(reason: string): VerificationResult {
  return { ok: false, reason, requiresHuman: false };
}

function needsHuman(reason: string): VerificationResult {
  return { ok: false, reason, requiresHuman: true };
}

export async function runVerification(
  spec: VerificationSpec | null,
): Promise<VerificationResult> {
  if (!spec || spec.kind === 'manual') {
    return needsHuman('manual verification — human must approve');
  }

  switch (spec.kind) {
    case 'file_exists': {
      return fs.existsSync(spec.path)
        ? pass(`file exists: ${spec.path}`)
        : fail(`file missing: ${spec.path}`);
    }
    case 'file_contains': {
      if (!fs.existsSync(spec.path)) return fail(`file missing: ${spec.path}`);
      const body = fs.readFileSync(spec.path, 'utf-8');
      let re: RegExp;
      try { re = new RegExp(spec.pattern); } catch { return fail(`invalid regex: ${spec.pattern}`); }
      return re.test(body)
        ? pass(`file matches: ${spec.path}`)
        : fail(`file does not match /${spec.pattern}/: ${spec.path}`);
    }
    case 'url_ok': {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 5000);
        const res = await fetch(spec.url, { signal: ctl.signal });
        clearTimeout(t);
        return res.ok
          ? pass(`${res.status} ${spec.url}`)
          : fail(`HTTP ${res.status} ${spec.url}`);
      } catch (e) {
        return fail(`fetch failed ${spec.url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    case 'shell': {
      const expectExit = spec.expectExit ?? 0;
      try {
        execSync(spec.command, { stdio: 'pipe', timeout: 30_000, cwd: '/tmp' });
        return expectExit === 0
          ? pass(`shell exit 0: ${spec.command}`)
          : fail(`expected exit ${expectExit}, got 0: ${spec.command}`);
      } catch (e) {
        const code = (e as { status?: number }).status ?? 1;
        return code === expectExit
          ? pass(`shell exit ${code}: ${spec.command}`)
          : fail(`shell exit ${code} (expected ${expectExit}): ${spec.command}`);
      }
    }
  }
}
