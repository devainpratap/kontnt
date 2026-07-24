import { and, eq, lt, sql } from "drizzle-orm";

import { ClientRepository } from "../clients/repository";
import { rankConfig } from "../config";
import { db } from "../db/client";
import { gscDailyTable } from "../db/schema";
import { addDays, todayInGscZone } from "../gsc/date-utils";
import { GscSyncService } from "../gsc/sync";
import { GoogleAccountRepository } from "../google/account-repository";
import { InsightService } from "../insights/insight-service";
import type { Finding } from "./rules";

/**
 * The safe auto-remediation allowlist.
 *
 * This is the hard boundary on what the Operator may do on its own. Every
 * action here is reversible or idempotent and touches only operational state -
 * never code, never money, never client-facing output, never deletion beyond
 * the configured retention. A finding whose kind is not in this map is never
 * acted on, no matter what the rules or the model say. That is the whole safety
 * model: the set of possible autonomous actions is fixed and small.
 */

export type RemediationResult = {
  /** Human-readable line for the journal. */
  description: string;
  ok: boolean;
};

/** Which finding kinds have a safe fix, mapped to the action that performs it. */
const ALLOWLIST: Record<string, (finding: Finding) => Promise<RemediationResult>> = {
  "stuck-running-rows": reconcileStuckRows,
  "db-over-retention": pruneOldGscDaily,
  "sync-recently-failed": retrySync,
  "gsc-data-stale": retrySync
};

export function isRemediable(kind: string): boolean {
  return kind in ALLOWLIST;
}

/**
 * Reconcile rows left "running" by an interrupted process. Reuses the exact
 * boot-time reconcilers, so this is identical to what already runs on startup.
 */
async function reconcileStuckRows(): Promise<RemediationResult> {
  const syncCount = new ClientRepository().reconcileInterruptedRuns();
  const insightCount = new InsightService().reconcileInterruptedInsights();
  return {
    ok: true,
    description: `Reconciled ${syncCount} stuck sync run(s) and ${insightCount} stuck report(s) to "failed".`
  };
}

/**
 * Prune gsc_daily rows older than the retention window.
 *
 * The weekly rollups (gsc_weekly_rollup) and the raw JSON on disk are
 * untouched, so charts and re-derivation still work - only the redundant
 * daily detail past the window is removed. This is the safe fix for the
 * unbounded-growth problem, and it is idempotent (re-running prunes nothing new).
 */
async function pruneOldGscDaily(): Promise<RemediationResult> {
  const cutoff = addDays(todayInGscZone(), -rankConfig.gscRetentionDays);

  const before = Number(db.select({ n: sql<number>`COUNT(*)` }).from(gscDailyTable).get()?.n ?? 0);
  db.delete(gscDailyTable).where(lt(gscDailyTable.date, cutoff)).run();
  const after = Number(db.select({ n: sql<number>`COUNT(*)` }).from(gscDailyTable).get()?.n ?? 0);

  const removed = before - after;
  // Reclaim the freed pages so the file actually shrinks.
  if (removed > 0) {
    db.run(sql`VACUUM`);
  }

  return {
    ok: true,
    description:
      removed > 0
        ? `Pruned ${removed.toLocaleString()} gsc_daily rows older than ${cutoff} (kept weekly rollups); ${after.toLocaleString()} rows remain.`
        : `No gsc_daily rows older than ${cutoff} to prune.`
  };
}

/**
 * Retry a client's Search Console sync. Idempotent (the sync itself upserts),
 * so a retry can never duplicate data. Requires a linked property and a live
 * Google connection - if the token is dead, this is not the right fix and the
 * caller will have escalated instead.
 */
async function retrySync(finding: Finding): Promise<RemediationResult> {
  if (!finding.clientId) {
    return { ok: false, description: "Sync retry skipped: no client on the finding." };
  }
  if (!new GoogleAccountRepository().isConnected()) {
    return { ok: false, description: "Sync retry skipped: Google is not connected." };
  }

  const clients = new ClientRepository();
  const client = clients.getClient(finding.clientId);
  if (!client?.gscProperty) {
    return { ok: false, description: "Sync retry skipped: client has no linked property." };
  }

  try {
    const result = await new GscSyncService().syncClient({ clientId: finding.clientId });
    return { ok: true, description: `Re-synced ${client.name}: ${result.rowsWritten} rows written.` };
  } catch (error) {
    return {
      ok: false,
      description: `Re-sync of ${client.name} failed: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
}

/**
 * Run the safe fix for a finding, if one exists.
 *
 * `attemptCount` is the number of times this same finding kind has already been
 * auto-fixed recently; past the cap the action is withheld so a persistently
 * failing fix cannot become a retry storm - it escalates instead.
 */
export async function remediate(
  finding: Finding,
  options: { attemptCount?: number; maxAttempts?: number } = {}
): Promise<RemediationResult | null> {
  const action = ALLOWLIST[finding.kind];
  if (!action) {
    return null; // not on the allowlist - never acted on
  }

  const maxAttempts = options.maxAttempts ?? 3;
  if ((options.attemptCount ?? 0) >= maxAttempts) {
    return {
      ok: false,
      description: `Withheld auto-fix for "${finding.kind}" after ${options.attemptCount} recent attempts - escalating instead.`
    };
  }

  return action(finding);
}
