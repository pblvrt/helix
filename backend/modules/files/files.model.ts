/**
 * File read/write for the in-app artifact viewer.
 *
 * Scoped to an allowlist of trusted roots — only paths that resolve inside one
 * of these may be read or written. Anything else returns a clear error.
 *
 * Roots are derived from PathConfig so unit tests + the packaged app route
 * through the same resolution.
 */

import fs from 'fs';
import path from 'path';
import type { PathConfig } from '../../core/paths.js';

/**
 * Additional filesystem roots the in-app file viewer is allowed to read.
 * Drives the security boundary for the artifact UI — anything outside the
 * project, the data dir, or these extras is rejected.
 *
 * Extend via the `HELIX_EXTRA_FS_ROOTS` env var (colon-separated absolute
 * paths). The default `/tmp` is included so agents can stash interim
 * output that the UI can preview without the operator opening Finder.
 */
function extraRootsFromEnv(): string[] {
  const raw = process.env.HELIX_EXTRA_FS_ROOTS;
  const fromEnv = raw ? raw.split(':').map(s => s.trim()).filter(Boolean) : [];
  return ['/tmp', ...fromEnv];
}

const TEXT_EXTS   = new Set(['.md', '.markdown', '.txt', '.json', '.jsonl', '.yml', '.yaml', '.log', '.csv']);
const IMAGE_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const MAX_BYTES   = 5 * 1024 * 1024; // 5 MB safety cap for both reads and writes

export interface ReadResult {
  path: string;
  kind: 'text' | 'image';
  contentType: string;      // mime-ish hint
  content: string;          // text content OR data URL for images
  size: number;
  modifiedAt: string;
}

export class FileAccessError extends Error {
  code: 'OUTSIDE_ALLOWLIST' | 'NOT_FOUND' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'WRITE_DENIED';
  constructor(code: FileAccessError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export function createFilesRepository(paths: PathConfig) {
  const allowedRoots = [
    paths.dataDir,
    paths.projectDir, // the repo root — includes .claude/, scripts/, etc.
    ...extraRootsFromEnv(),
  ].map(p => path.resolve(p));

  function resolveAllowed(rawPath: string): string {
    const resolved = path.resolve(rawPath);
    const ok = allowedRoots.some(root => resolved === root || resolved.startsWith(root + path.sep));
    if (!ok) {
      throw new FileAccessError('OUTSIDE_ALLOWLIST', `Path is outside the allowlist: ${resolved}`);
    }
    return resolved;
  }

  function kindFor(ext: string): 'text' | 'image' | null {
    if (TEXT_EXTS.has(ext))  return 'text';
    if (IMAGE_EXTS.has(ext)) return 'image';
    return null;
  }

  function mimeFor(ext: string): string {
    switch (ext) {
      case '.md': case '.markdown': return 'text/markdown';
      case '.json': case '.jsonl':  return 'application/json';
      case '.yml': case '.yaml':    return 'application/yaml';
      case '.png':  return 'image/png';
      case '.jpg': case '.jpeg': return 'image/jpeg';
      case '.gif':  return 'image/gif';
      case '.webp': return 'image/webp';
      case '.svg':  return 'image/svg+xml';
      default:      return 'text/plain';
    }
  }

  return {
    /** Read a file from an allowed root. Images returned as data URLs. */
    read(rawPath: string): ReadResult {
      const resolved = resolveAllowed(rawPath);
      if (!fs.existsSync(resolved)) {
        throw new FileAccessError('NOT_FOUND', `File not found: ${resolved}`);
      }
      const stat = fs.statSync(resolved);
      if (stat.size > MAX_BYTES) {
        throw new FileAccessError('TOO_LARGE', `File is larger than 5 MB (${stat.size} bytes)`);
      }
      const ext = path.extname(resolved).toLowerCase();
      const kind = kindFor(ext);
      if (!kind) {
        throw new FileAccessError('UNSUPPORTED_TYPE', `Can't preview ${ext} files in-app`);
      }
      const mime = mimeFor(ext);
      const content = kind === 'image'
        ? `data:${mime};base64,${fs.readFileSync(resolved).toString('base64')}`
        : fs.readFileSync(resolved, 'utf-8');
      return {
        path: resolved,
        kind,
        contentType: mime,
        content,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    },

    /** Write text content to an allowed path. Images aren't editable in-app. */
    write(rawPath: string, content: string): ReadResult {
      const resolved = resolveAllowed(rawPath);
      const ext = path.extname(resolved).toLowerCase();
      const kind = kindFor(ext);
      if (kind !== 'text') {
        throw new FileAccessError('WRITE_DENIED', `Only text files can be written in-app (got ${ext})`);
      }
      if (content.length > MAX_BYTES) {
        throw new FileAccessError('TOO_LARGE', `Content exceeds 5 MB cap`);
      }
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, 'utf-8');
      return this.read(resolved);
    },

    /** Expose allowlist for debugging / UI messages. */
    listAllowedRoots(): string[] {
      return allowedRoots;
    },
  };
}
