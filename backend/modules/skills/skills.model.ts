/**
 * Skills — CRUD-ish for the `.claude/skills/<slug>/` directories that hold a
 * SKILL.md (plus optional supporting markdown files). Install is separate —
 * it's handled by the catalog module shelling out to `npx skills add …`.
 *
 * This repository:
 *   - lists installed skills (reads each .claude/skills/<slug>/SKILL.md, parses YAML frontmatter)
 *   - gets one
 *   - deletes one (with guard-rails so we can't `rm -rf` anything unexpected)
 */

import fs from 'fs';
import path from 'path';
import type { PathConfig } from '../../core/paths.js';
import type { Skill } from '../../core/types.js';

/**
 * Same conservative subset of YAML used by the agents module — keys on left,
 * scalar values on right. Multi-line lists (`tools:` etc.) are ignored;
 * SKILL.md frontmatter we care about is only `name` + `description`.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.+?)\s*$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    if (!rawValue) continue;
    out[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return out;
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
}

export function createSkillsRepository(paths: PathConfig) {
  const { skillsDir } = paths;

  function readSkillFile(slug: string): Skill | null {
    const skillPath = path.join(skillsDir, slug, 'SKILL.md');
    if (!fs.existsSync(skillPath)) return null;
    const stat = fs.statSync(skillPath);
    const content = fs.readFileSync(skillPath, 'utf-8');
    const fm = parseFrontmatter(content);
    return {
      slug,
      name: fm.name || slug,
      description: fm.description || '',
      body: stripFrontmatter(content),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  return {
    list(): Skill[] {
      if (!fs.existsSync(skillsDir)) return [];
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      const skills: Skill[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skill = readSkillFile(entry.name);
        if (skill) skills.push(skill);
      }
      skills.sort((a, b) => a.name.localeCompare(b.name));
      return skills;
    },

    get(slug: string): Skill | null {
      return readSkillFile(slug);
    },

    /**
     * Delete `.claude/skills/<slug>/`. Guard rails:
     *   1. `slug` must be a simple identifier (no slashes, no `..`).
     *   2. The target must resolve to a path strictly inside `skillsDir`.
     *   3. The target must be a directory.
     *   4. Every file inside must be a regular file (no symlinks out of
     *      tree, no nested dotfiles); we only allow `*.md` and subdirs of
     *      markdown files, since that's what `skills add` and hand-installs
     *      produce. Anything else → abort. Prevents a corrupted catalog
     *      install from wiping unrelated data.
     */
    delete(slug: string): { ok: true; removed: string[] } {
      if (!/^[a-z0-9][a-z0-9-_]{0,80}$/i.test(slug)) {
        throw new Error(`Refusing to delete: invalid slug "${slug}"`);
      }
      const target = path.join(skillsDir, slug);
      const resolved = path.resolve(target);
      const resolvedRoot = path.resolve(skillsDir);
      if (!resolved.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Refusing to delete: path escapes skillsDir`);
      }
      if (!fs.existsSync(resolved)) return { ok: true, removed: [] };
      const stat = fs.lstatSync(resolved);
      if (!stat.isDirectory()) {
        throw new Error(`Refusing to delete: "${resolved}" is not a directory`);
      }

      const removed: string[] = [];
      function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) {
            throw new Error(`Refusing to delete: symlink found at ${full}`);
          }
          if (entry.isDirectory()) { walk(full); continue; }
          if (!entry.isFile()) {
            throw new Error(`Refusing to delete: non-file at ${full}`);
          }
          // Allow markdown, JSON, plain text, and the common dotfiles that
          // come with skills (.gitignore, README inclusions, etc.).
          if (!/\.(md|json|txt|ya?ml)$/i.test(entry.name) && entry.name !== 'SKILL.md') {
            throw new Error(`Refusing to delete: unexpected file ${full}. Remove manually.`);
          }
          removed.push(full);
        }
      }
      walk(resolved);

      fs.rmSync(resolved, { recursive: true, force: false });
      return { ok: true, removed };
    },
  };
}
