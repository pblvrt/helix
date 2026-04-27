/**
 * System utilities — Chrome detection, binary lookup, HTTP helpers.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';

export function whichSync(bin: string): string | null {
  for (const dir of (process.env.PATH || '').split(':')) {
    const full = path.join(dir, bin);
    try { if (fs.existsSync(full) && fs.statSync(full).mode & 0o111) return full; } catch {}
  }
  return null;
}

export function findChromePath(): string | null {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function httpGet(url: string, timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export async function waitForPort(port: number, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await httpGet(`http://localhost:${port}/json/version`, 1000); return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
