/**
 * Fix PATH — ensures spawned processes can find nvm-installed node,
 * homebrew binaries, and globally installed CLIs.
 */

import fs from 'fs';
import path from 'path';

export function fixPath(): void {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const extraDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.fnm', 'aliases', 'default', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.bun', 'bin'),
  ];

  // Resolve nvm current version
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    if (fs.existsSync(nvmDir)) {
      const aliasPath = path.join(home, '.nvm', 'alias', 'default');
      let targetVersion = '';
      try {
        const alias = fs.readFileSync(aliasPath, 'utf-8').trim();
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        targetVersion = versions.find(v => v.includes(alias.replace('v', ''))) || versions[0] || '';
      } catch {
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        targetVersion = versions[0] || '';
      }
      if (targetVersion) extraDirs.push(path.join(nvmDir, targetVersion, 'bin'));
    }
  } catch {}

  const currentPath = process.env.PATH || '';
  const newDirs = extraDirs.filter(d => {
    try { return fs.existsSync(d) && !currentPath.includes(d); } catch { return false; }
  });
  if (newDirs.length > 0) process.env.PATH = [...newDirs, currentPath].join(':');
}
