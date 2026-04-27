/**
 * Scheduler — cron job management.
 * Uses the job manager for execution; only handles cron timing.
 */

import cron, { type ScheduledTask } from 'node-cron';
import type { Schedule } from '../../core/types.js';

export function createScheduler(opts: {
  getSchedules: () => Schedule[];
  submitJob: (command: string) => string;
  updateRunStatus: (scheduleId: string, status: string, runId?: string) => void;
}) {
  const { getSchedules, submitJob, updateRunStatus } = opts;
  const cronJobs = new Map<string, ScheduledTask>();

  function startJob(schedule: Schedule) {
    if (cronJobs.has(schedule.id)) {
      cronJobs.get(schedule.id)!.stop();
    }

    if (!schedule.enabled || !cron.validate(schedule.cronExpression)) return;

    const job = cron.schedule(schedule.cronExpression, async () => {
      console.log(`[scheduler] Cron fired: ${schedule.command} (schedule: ${schedule.id})`);

      try {
        const runId = submitJob(schedule.command);
        console.log(`[scheduler] Submitted ${schedule.command} → action #${runId}`);
        updateRunStatus(schedule.id, 'queued', runId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`[scheduler] Skipped ${schedule.command}: ${msg}`);
        // Don't mark as error — it's expected when already running
      }
    });

    cronJobs.set(schedule.id, job);
  }

  function stopJob(scheduleId: string) {
    if (cronJobs.has(scheduleId)) {
      cronJobs.get(scheduleId)!.stop();
      cronJobs.delete(scheduleId);
    }
  }

  return {
    init(): void {
      getSchedules().filter(s => s.enabled).forEach(startJob);
    },
    startJob,
    stopJob,
  };
}
