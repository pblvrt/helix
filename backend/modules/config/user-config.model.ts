import fs from 'fs';
import type Database from 'better-sqlite3';
import type { PathConfig } from '../../core/paths.js';
import type { UserConfig } from '../../core/types.js';
import { DEFAULT_USER_CONFIG } from '../../core/types.js';

export function createUserConfigRepository(deps: { db: Database.Database; paths: PathConfig }) {
  const { db, paths } = deps;

  function migrateFromJsonIfNeeded(): void {
    const existing = db.prepare('SELECT config_json FROM user_config WHERE id = 1').get() as { config_json: string } | undefined;
    if (existing) return;
    let migrated: Partial<UserConfig> = {};
    try {
      if (fs.existsSync(paths.userConfigPath)) {
        migrated = JSON.parse(fs.readFileSync(paths.userConfigPath, 'utf-8'));
      }
    } catch {}
    const merged = { ...DEFAULT_USER_CONFIG, ...migrated };
    db.prepare(`
      INSERT INTO user_config (id, config_json, updated_at)
      VALUES (1, ?, datetime('now'))
    `).run(JSON.stringify(merged));
  }

  migrateFromJsonIfNeeded();

  function read(): UserConfig {
    const row = db.prepare('SELECT config_json FROM user_config WHERE id = 1').get() as { config_json: string } | undefined;
    if (!row) return { ...DEFAULT_USER_CONFIG };
    try {
      return { ...DEFAULT_USER_CONFIG, ...JSON.parse(row.config_json) };
    } catch {
      return { ...DEFAULT_USER_CONFIG };
    }
  }

  return {
    get(): UserConfig {
      return read();
    },

    save(config: UserConfig): { ok: true } {
      config.updatedAt = new Date().toISOString();
      if (!config.createdAt) config.createdAt = config.updatedAt;
      db.prepare(`
        INSERT INTO user_config (id, config_json, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(config), config.updatedAt);
      return { ok: true };
    },

    status(): { exists: boolean; onboardingCompleted: boolean } {
      const row = db.prepare('SELECT config_json FROM user_config WHERE id = 1').get() as { config_json: string } | undefined;
      if (!row) return { exists: false, onboardingCompleted: false };
      try {
        const c = JSON.parse(row.config_json);
        return { exists: true, onboardingCompleted: !!c.onboardingCompleted };
      } catch {
        return { exists: false, onboardingCompleted: false };
      }
    },
  };
}
