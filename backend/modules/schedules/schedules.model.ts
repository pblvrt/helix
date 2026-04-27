import fs from 'fs';
import type { PathConfig } from '../../core/paths.js';
import type { Schedule } from '../../core/types.js';

export function createSchedulesRepository(paths: PathConfig) {
  function read(): Schedule[] {
    if (!fs.existsSync(paths.schedulesPath)) return [];
    return JSON.parse(fs.readFileSync(paths.schedulesPath, 'utf-8'));
  }

  function write(schedules: Schedule[]) {
    fs.writeFileSync(paths.schedulesPath, JSON.stringify(schedules, null, 2), 'utf-8');
  }

  return {
    list(): Schedule[] {
      return read();
    },

    create(data: { command: string; cronExpression: string; description?: string; enabled?: boolean }): Schedule {
      const schedule: Schedule = {
        id: Math.random().toString(36).slice(2, 10),
        command: data.command,
        cronExpression: data.cronExpression,
        enabled: data.enabled !== false,
        description: data.description || '',
        lastRun: null,
        lastRunId: null,
        lastStatus: null,
        createdAt: new Date().toISOString(),
      };

      const schedules = read();
      schedules.push(schedule);
      write(schedules);
      return schedule;
    },

    update(id: string, data: Partial<Schedule>): Schedule | null {
      const schedules = read();
      const idx = schedules.findIndex(s => s.id === id);
      if (idx === -1) return null;

      Object.assign(schedules[idx], data);
      write(schedules);
      return schedules[idx];
    },

    delete(id: string): { ok: true } | null {
      const schedules = read();
      const idx = schedules.findIndex(s => s.id === id);
      if (idx === -1) return null;

      schedules.splice(idx, 1);
      write(schedules);
      return { ok: true };
    },

    updateRunStatus(scheduleId: string, status: string, runId?: string): void {
      const schedules = read();
      const idx = schedules.findIndex(s => s.id === scheduleId);
      if (idx !== -1) {
        schedules[idx].lastStatus = status as Schedule['lastStatus'];
        if (runId) schedules[idx].lastRunId = runId;
        if (status === 'running') schedules[idx].lastRun = new Date().toISOString();
        write(schedules);
      }
    },
  };
}
