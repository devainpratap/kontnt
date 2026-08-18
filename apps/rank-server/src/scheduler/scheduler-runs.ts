import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray } from "drizzle-orm";

import type { SchedulerRunStatus, SchedulerTrigger } from "@rankos/shared";

import { db } from "../db/client";
import { schedulerRunsTable } from "../db/schema";

/**
 * Persistence for scheduled-task runs.
 *
 * The scheduler kept last-run state in memory only, so a restart erased it and
 * missed-run recovery had nothing to compare against. Every run now writes a
 * row here, which (a) survives restarts to back the Settings "last run" display
 * and (b) lets recovery ask "has this task run since its last scheduled fire?".
 */

export type LastRun = { at: string; summary: string; trigger: SchedulerTrigger };

/**
 * Record one run. Best-effort: a telemetry write must never break the actual
 * scheduled work, so a DB failure is logged and swallowed rather than thrown.
 */
export function recordSchedulerRun(input: {
  taskName: string;
  trigger: SchedulerTrigger;
  status: SchedulerRunStatus;
  summary: string;
  ranAt?: string;
}): void {
  try {
    db.insert(schedulerRunsTable)
      .values({
        id: randomUUID(),
        taskName: input.taskName,
        ranAt: input.ranAt ?? new Date().toISOString(),
        trigger: input.trigger,
        status: input.status,
        summary: input.summary
      })
      .run();
  } catch (error) {
    console.error("[scheduler] failed to persist run:", error instanceof Error ? error.message : error);
  }
}

/**
 * The most recent run of each task, for seeding the in-memory lastRuns on boot
 * so history is not lost across restarts. Newest-first scan, first per task wins.
 */
export function latestRunPerTask(): Record<string, LastRun> {
  const rows = db
    .select({
      taskName: schedulerRunsTable.taskName,
      ranAt: schedulerRunsTable.ranAt,
      summary: schedulerRunsTable.summary,
      trigger: schedulerRunsTable.trigger
    })
    .from(schedulerRunsTable)
    .orderBy(desc(schedulerRunsTable.ranAt))
    .all();

  const out: Record<string, LastRun> = {};
  for (const row of rows) {
    if (!out[row.taskName]) {
      out[row.taskName] = { at: row.ranAt, summary: row.summary, trigger: row.trigger };
    }
  }
  return out;
}

/**
 * Did this task run at all since `since`? Any recorded run counts - an on-time
 * cron fire, or a skip ("nothing due", "Google not connected") which still means
 * the schedule fired and decided not to act. A *missed* run is the absence of
 * any row since the last scheduled fire; that is what recovery catches up.
 * (Retrying a genuinely failed run is the Operator's remediation job, not this.)
 *
 * ISO-8601 UTC timestamps sort lexicographically in chronological order, so a
 * string `>=` comparison is a correct instant comparison.
 */
export function hasRunSince(taskName: string, since: Date): boolean {
  const row = db
    .select({ id: schedulerRunsTable.id })
    .from(schedulerRunsTable)
    .where(and(eq(schedulerRunsTable.taskName, taskName), gte(schedulerRunsTable.ranAt, since.toISOString())))
    .limit(1)
    .get();
  return Boolean(row);
}

/**
 * How many runs since `since` were recoveries (boot/heartbeat) rather than
 * on-time cron fires. A high count means the machine is regularly asleep at cron
 * time - the signal the Operator turns into an "enable auto-wake" suggestion.
 */
export function countRecoveredRunsSince(since: Date): number {
  const rows = db
    .select({ id: schedulerRunsTable.id })
    .from(schedulerRunsTable)
    .where(
      and(
        inArray(schedulerRunsTable.trigger, ["boot", "heartbeat"] as SchedulerTrigger[]),
        gte(schedulerRunsTable.ranAt, since.toISOString())
      )
    )
    .all();
  return rows.length;
}
