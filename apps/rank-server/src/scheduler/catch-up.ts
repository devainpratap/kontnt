import type { SchedulerTrigger } from "@rankos/shared";

import { rankConfig } from "../config";
import { mostRecentScheduledFire } from "./cron-window";
import { hasRunSince as hasRunSinceDefault } from "./scheduler-runs";

/**
 * Missed-run recovery.
 *
 * node-cron only fires while the process is up, so a run scheduled for a time
 * the machine was asleep or off is silently skipped forever. This closes that
 * gap: for each task, find its most recent scheduled fire and, if nothing has
 * run since then, run it now. Called on boot (machine was off) and hourly
 * (machine woke without a restart).
 *
 * A "missed" run is the *absence* of any run since the last fire. Idempotency is
 * layered: this gate stops a task being re-attempted once it has run since the
 * fire, and the runners themselves are idempotent (the weekly report will not
 * produce a second copy within the week, syncs upsert, SERP checks only fetch
 * cadence-due keywords). So running this often is safe.
 *
 * The schedule and runners are injected rather than imported from
 * scheduler.ts - that keeps this module free of an import cycle and trivially
 * testable with stub runners.
 */

export type CatchUpTask = { name: string; cron: string };

export type CatchUpOptions = {
  trigger: Extract<SchedulerTrigger, "boot" | "heartbeat">;
  schedule: CatchUpTask[];
  runners: Record<string, (trigger: SchedulerTrigger) => Promise<void>>;
  now?: Date;
  /** Injectable for tests; defaults to the real fire computation. */
  fire?: (cronExpr: string, now: Date) => Date | null;
  /** Injectable for tests; defaults to the persisted scheduler_runs query. */
  hasRunSince?: (taskName: string, since: Date) => boolean;
};

export async function catchUpMissedRuns(options: CatchUpOptions): Promise<{ recovered: string[] }> {
  const now = options.now ?? new Date();
  const recovered: string[] = [];

  // Respects the same master switch as the scheduler, plus its own opt-out.
  if (!rankConfig.schedulerEnabled || !rankConfig.schedulerCatchupEnabled) {
    return { recovered };
  }

  const fire = options.fire ?? mostRecentScheduledFire;
  const ranSince = options.hasRunSince ?? hasRunSinceDefault;

  // Sequential on purpose: a recovered gsc-sync should finish before a recovered
  // weekly-report reads that data. Each runner also takes the shared run-lock,
  // so a recovery can never collide with an on-time or manual run.
  for (const task of options.schedule) {
    if (!task.cron) {
      continue;
    }
    const lastFire = fire(task.cron, now);
    if (!lastFire) {
      continue; // unparseable/disabled cron - nothing to anchor a miss to
    }
    if (ranSince(task.name, lastFire)) {
      continue; // already ran since its last scheduled fire - not missed
    }
    const runner = options.runners[task.name];
    if (!runner) {
      continue;
    }
    try {
      await runner(options.trigger);
      recovered.push(task.name);
    } catch (error) {
      console.error(
        `[scheduler] catch-up ${task.name} threw:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  if (recovered.length > 0) {
    console.log(`[scheduler] catch-up (${options.trigger}) recovered: ${recovered.join(", ")}`);
  }

  return { recovered };
}
