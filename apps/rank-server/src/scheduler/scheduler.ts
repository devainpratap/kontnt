import cron, { type ScheduledTask } from "node-cron";

import type { SchedulerRunStatus, SchedulerTrigger } from "@rankos/shared";

import { ClientRepository } from "../clients/repository";
import { rankConfig } from "../config";
import { latestLikelyDataDate } from "../gsc/date-utils";
import { getDateBounds } from "../gsc/queries";
import * as runLock from "../gsc/run-lock";
import { GscSyncService } from "../gsc/sync";
import { GoogleAccountRepository } from "../google/account-repository";
import { InsightService } from "../insights/insight-service";
import { getKeywordsWithLastCheck } from "../serp/queries";
import { runCheckBatch, selectDueKeywords } from "../serp/queue";
import { RankCheckService } from "../serp/rank-check-service";
import { isEmailConfigured, sendReportEmail } from "../notify/email";
import { OperatorService } from "../operator/operator-service";
import { catchUpMissedRuns } from "./catch-up";
import { mostRecentScheduledFire } from "./cron-window";
import { latestRunPerTask, recordSchedulerRun } from "./scheduler-runs";

/**
 * The scheduler turns RankOS from a tool you operate into a system that
 * maintains itself.
 *
 * Everything it does is something the operator can already trigger by hand; the
 * scheduler just does it on a cadence. It runs inside the local server process,
 * which has one honest consequence worth stating plainly: **it only runs while
 * the machine is awake and the server is up.** GSC gaps from downtime are
 * recoverable (Google keeps 16 months, and boot backfill fills them); missed
 * live SERP checks are not, so a keyword simply shows its real last-checked age.
 *
 * Every task takes the same in-flight lock the manual routes use, so a
 * scheduled run and a hand-triggered run can never collide.
 */

export type SchedulerTask = {
  name: string;
  cron: string;
  description: string;
};

export type SchedulerState = {
  enabled: boolean;
  tasks: Array<SchedulerTask & { nextNote: string }>;
  lastRuns: Record<string, { at: string; summary: string; trigger?: SchedulerTrigger }>;
};

const tasks: ScheduledTask[] = [];

const clients = new ClientRepository();
const google = new GoogleAccountRepository();
const gscSync = new GscSyncService(clients, google);
const rankChecks = new RankCheckService(clients);
const insights = new InsightService(clients);
const operator = new OperatorService();

/**
 * Record a run to the console and to the persisted scheduler_runs table, which
 * survives restarts (backing the Settings "last run" display) and lets
 * missed-run recovery tell whether a task has run since its last scheduled fire.
 * Every runner calls this in all its exit paths, so "did this task run?" always
 * has an answer. `trigger` marks an on-time `cron` fire vs a `boot`/`heartbeat`
 * recovery vs a `manual` run.
 */
function record(
  name: string,
  summary: string,
  options: { trigger?: SchedulerTrigger; status?: SchedulerRunStatus } = {}
) {
  const trigger = options.trigger ?? "cron";
  recordSchedulerRun({ taskName: name, trigger, status: options.status ?? "ok", summary });
  console.log(`[scheduler] ${name} (${trigger}): ${summary}`);
}

/** Clients with a linked property, the only ones any task can act on. */
function activeClients() {
  return clients.listClients().filter((client) => !client.archivedAt && client.gscProperty);
}

/**
 * Sync Search Console for every linked client, serialised.
 *
 * Serial rather than parallel so one client's quota backoff cannot stall the
 * others, and so the shared in-flight lock is respected per client.
 */
async function runGscSyncAll(trigger: SchedulerTrigger = "cron"): Promise<void> {
  if (!google.isConnected()) {
    record("gsc-sync", "skipped - Google not connected", { trigger, status: "skipped" });
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const client of activeClients()) {
    const started = runLock.start(client.id, "gsc-sync", (signal) => gscSync.syncClient({ clientId: client.id, signal }));
    if (!started) {
      continue; // a manual sync is already running for this client
    }
    try {
      await runLock.drain();
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  record("gsc-sync", `${ok} synced, ${failed} failed`, {
    trigger,
    status: failed > 0 && ok === 0 ? "failed" : "ok"
  });
}

/**
 * Check every keyword that is due, across clients, within the daily cap.
 *
 * Due-ness comes from each keyword's cadence, so this is safe to run daily: only
 * keywords whose interval has elapsed are actually fetched.
 */
async function runSerpDue(trigger: SchedulerTrigger = "cron"): Promise<void> {
  let checked = 0;
  let blocked = 0;

  for (const client of activeClients()) {
    if (rankChecks.remainingToday() <= 0) {
      record("serp-checks", `stopped at daily cap; ${checked} checked`, { trigger });
      return;
    }

    const due = selectDueKeywords(getKeywordsWithLastCheck(client.id));
    if (due.length === 0) {
      continue;
    }

    const started = runLock.start(client.id, "serp-batch", async (signal) => {
      const runId = rankChecks.startRun(client.id);
      const progress = await runCheckBatch(due, rankChecks, { signal });
      rankChecks.finishRun(
        runId,
        { ok: progress.ok, blocked: progress.blocked, failed: progress.failed },
        progress.stoppedReason
      );
      checked += progress.ok;
      blocked += progress.blocked;
    });

    if (started) {
      await runLock.drain();
    }
  }

  record("serp-checks", `${checked} checked, ${blocked} blocked`, { trigger });
}

/**
 * Run the Operator: RankOS supervising itself. Auto-fixes the safe things and
 * escalates the rest, per OPERATOR_AUTONOMY. Best-effort - a failure here must
 * not disturb the other scheduled work.
 */
async function runOperator(trigger: SchedulerTrigger = "cron"): Promise<void> {
  if (!rankConfig.operatorEnabled) {
    record("operator", "disabled", { trigger, status: "skipped" });
    return;
  }
  try {
    const result = await operator.run({ apply: rankConfig.operatorAutonomy === "auto" });
    record(
      "operator",
      `${result.record.healthLevel} - ${result.record.actionsCount} fixed, ${result.record.escalationsCount} escalated`,
      { trigger }
    );
  } catch (error) {
    record("operator", `failed: ${error instanceof Error ? error.message : "unknown"}`, {
      trigger,
      status: "failed"
    });
  }
}

/** Generate the weekly report + brief for every linked client. */
async function runWeeklyReports(trigger: SchedulerTrigger = "cron"): Promise<void> {
  let made = 0;
  let skipped = 0;
  let emailed = 0;

  // Produce at most one report per scheduled cycle. The cutoff is this cycle's
  // most recent report fire, so a report already produced this cycle - by the
  // on-time cron, a boot/heartbeat recovery, or (on first deploy) one that
  // pre-dates run history - is not re-sent, while a due report is never
  // suppressed by an unrelated manual run earlier in the cycle. Falls back to a
  // 6-day window only if the report cron is unset/invalid.
  const now = new Date();
  const reportFire = mostRecentScheduledFire(rankConfig.schedulerReportCron, now);
  const producedSince = reportFire ?? new Date(now.getTime() - 6 * 86_400_000);

  for (const client of activeClients()) {
    if (insights.hasCompletedReportSince(client.id, "weekly-report", producedSince)) {
      skipped += 1;
      continue;
    }

    const started = runLock.start(client.id, "insight", async () => {
      try {
        const result = await insights.generate(client.id, { days: 7, kind: "weekly-report" });
        made += 1;

        // Deliver by email as the final step, so "fixed repetitive time" is
        // simply the report cron. Best-effort: an email failure must not fail
        // the generation - the report is already saved to disk. The allowlist
        // (EMAIL_CLIENTS) scopes which clients are emailed; empty means all.
        const emailThisClient =
          rankConfig.emailClients.length === 0 || rankConfig.emailClients.includes(client.slug.toLowerCase());
        if (rankConfig.emailEnabled && isEmailConfigured() && emailThisClient) {
          try {
            await sendReportEmail({
              clientName: client.name,
              period: `${result.record.periodStart} to ${result.record.periodEnd}`,
              reportMarkdown: result.markdown,
              brief: result.brief,
              attachments: [
                { filename: "report.md", content: result.markdown },
                ...(result.brief ? [{ filename: "whatsapp-brief.md", content: result.brief }] : [])
              ]
            });
            emailed += 1;
          } catch (emailError) {
            console.error(`[scheduler] report email failed for ${client.name}:`, emailError instanceof Error ? emailError.message : emailError);
          }
        }
      } catch {
        // No data, or Claude unavailable - the prompt is saved for manual use.
        skipped += 1;
      }
    });
    if (started) {
      await runLock.drain();
    }
  }

  record("weekly-reports", `${made} generated, ${skipped} skipped, ${emailed} emailed`, { trigger });
}

/**
 * Boot backfill: fill any GSC gap left by downtime.
 *
 * If the newest stored date for a client is behind the latest available date,
 * a normal sync (rolling window) may not reach far enough back, so this pulls
 * the span between them. Cheap when there is no gap.
 */
export async function backfillOnBoot(): Promise<void> {
  if (!google.isConnected()) {
    return;
  }

  for (const client of activeClients()) {
    const bounds = getDateBounds(client.id);
    const latest = latestLikelyDataDate();

    // No data at all, or already current - a routine sync covers it.
    if (!bounds.latest || bounds.latest >= latest) {
      continue;
    }

    const started = runLock.start(client.id, "gsc-sync", (signal) =>
      gscSync.syncClient({ clientId: client.id, startDate: bounds.latest as string, endDate: latest, signal })
    );
    if (started) {
      await runLock.drain();
    }
  }
  record("boot-backfill", "gap check complete", { trigger: "boot" });
}

const SCHEDULE: SchedulerTask[] = [
  { name: "gsc-sync", cron: rankConfig.schedulerGscCron, description: "Sync Search Console for all linked clients" },
  { name: "serp-checks", cron: rankConfig.schedulerSerpCron, description: "Check keywords whose cadence is due" },
  { name: "weekly-reports", cron: rankConfig.schedulerReportCron, description: "Generate the weekly report and WhatsApp brief" },
  { name: "operator", cron: rankConfig.operatorCron, description: "Supervise the system: auto-fix safe issues, escalate the rest" }
];

const RUNNERS: Record<string, (trigger: SchedulerTrigger) => Promise<void>> = {
  "gsc-sync": runGscSyncAll,
  "serp-checks": runSerpDue,
  "weekly-reports": runWeeklyReports,
  "operator": runOperator
};

/** Start all enabled cron tasks. Idempotent - stops any existing tasks first. */
export function startScheduler(): void {
  stopScheduler();

  if (!rankConfig.schedulerEnabled) {
    console.log("[scheduler] disabled (SCHEDULER_ENABLED=false)");
    return;
  }

  for (const task of SCHEDULE) {
    if (!task.cron || !cron.validate(task.cron)) {
      console.warn(`[scheduler] skipping ${task.name}: invalid or empty cron "${task.cron}"`);
      continue;
    }
    const runner = RUNNERS[task.name];
    const scheduled = cron.schedule(
      task.cron,
      () => {
        runner("cron").catch((error) => console.error(`[scheduler] ${task.name} threw:`, error?.message ?? error));
      },
      { timezone: "Asia/Kolkata" }
    );
    tasks.push(scheduled);
    console.log(`[scheduler] ${task.name} scheduled: ${task.cron}`);
  }

  // Missed-run recovery heartbeat: hourly, it re-checks whether any task slept
  // through its scheduled fire (the machine was asleep and later woke without a
  // restart) and catches it up. Boot covers the machine-was-off case; this
  // covers wake-without-restart. Idempotent, so a quiet hour does nothing.
  if (
    rankConfig.schedulerCatchupEnabled &&
    rankConfig.schedulerCatchupCron &&
    cron.validate(rankConfig.schedulerCatchupCron)
  ) {
    const heartbeat = cron.schedule(
      rankConfig.schedulerCatchupCron,
      () => {
        catchUpMissedRuns({ now: new Date(), trigger: "heartbeat", schedule: SCHEDULE, runners: RUNNERS }).catch(
          (error) => console.error("[scheduler] catch-up heartbeat threw:", error?.message ?? error)
        );
      },
      { timezone: "Asia/Kolkata" }
    );
    tasks.push(heartbeat);
    console.log(`[scheduler] catch-up heartbeat scheduled: ${rankConfig.schedulerCatchupCron}`);
  }
}

/**
 * Recover any run missed while the machine was off. Called once on boot, after
 * the server is listening and the GSC gap backfill has run. Best-effort.
 */
export async function runBootCatchUp(): Promise<void> {
  await catchUpMissedRuns({ now: new Date(), trigger: "boot", schedule: SCHEDULE, runners: RUNNERS });
}

export function stopScheduler(): void {
  while (tasks.length > 0) {
    tasks.pop()?.stop();
  }
}

export function getSchedulerState(): SchedulerState {
  return {
    enabled: rankConfig.schedulerEnabled,
    tasks: SCHEDULE.map((task) => ({
      ...task,
      nextNote: task.cron && cron.validate(task.cron) ? `Cron: ${task.cron} (Asia/Kolkata)` : "disabled"
    })),
    // Read from the persisted table, so history survives a restart.
    lastRuns: latestRunPerTask()
  };
}

/** Exposed so the routes can offer a manual "run now" for any scheduled task. */
export async function runTaskNow(name: string): Promise<void> {
  const runner = RUNNERS[name];
  if (!runner) {
    throw new Error(`Unknown scheduled task: ${name}`);
  }
  await runner("manual");
}
