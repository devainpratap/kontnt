import { statSync } from "node:fs";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import type { ProviderBudget } from "../serp/usage-ledger";

import { ClientRepository } from "../clients/repository";
import { rankConfig } from "../config";
import { db } from "../db/client";
import { gscDailyTable, insightsTable, rankChecksTable, syncRunsTable } from "../db/schema";
import { addDays, todayInGscZone } from "../gsc/date-utils";
import { getCoverage, getDateBounds } from "../gsc/queries";
import { GoogleAccountRepository } from "../google/account-repository";
import { emailStatus } from "../notify/email";
import { getCheckHealth } from "../serp/queries";
import { describeBudget } from "../serp/usage-ledger";

/**
 * A deterministic snapshot of RankOS's own health, gathered purely from the
 * database and config - no model, no network. The rule engine reasons over
 * this; the Operator reasons over the rules. Keeping the snapshot pure and
 * typed is what lets the rule engine be unit-tested without any live system.
 *
 * Everything time-derived reads from persisted rows (sync_runs, insights)
 * rather than the scheduler's in-memory state, so the picture survives a
 * restart and there is no import cycle with the scheduler.
 */

export type ClientSnapshot = {
  id: string;
  name: string;
  slug: string;
  gscProperty: string | null;
  /** Most recent completed GSC sync, and how many syncs have failed since. */
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  syncFailStreak: number;
  /** Newest GSC date on record, and how many days stale that is. */
  latestGscDate: string | null;
  staleGscDays: number | null;
  /** Live-rank-check health over the last 7 days. */
  checkHealth: { ok: number; notFound: number; blocked: number; error: number };
  blockedRate: number;
  /** Query-attribution coverage over the last 28 days (0-1), or null if no data. */
  coverageRatio: number | null;
  /** Queries sitting in striking distance (real volume, positions 4-20). */
  strikingDistanceCount: number;
};

export type OperatorSnapshot = {
  takenAt: string;
  google: { connected: boolean; needsReconnect: boolean; lastErrorMessage: string | null };
  providers: ProviderBudget[];
  scheduler: { enabled: boolean };
  email: { enabled: boolean; configured: boolean; to: string | null };
  db: { sizeBytes: number; gscDailyRows: number; oldestGscDate: string | null };
  /** Rows left "running" - a crash/restart artifact the Operator can reconcile. */
  stuckSyncRuns: number;
  stuckInsights: number;
  clients: ClientSnapshot[];
};

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function countRunning(table: typeof syncRunsTable | typeof insightsTable): number {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(table)
    .where(eq(table.status, "running"))
    .get();
  return Number(row?.n ?? 0);
}

/**
 * Consecutive failed GSC syncs from most recent backwards, and the last one
 * that actually completed. A streak is what distinguishes a one-off hiccup
 * (ignore) from a real, escalate-worthy failure.
 */
function syncHealth(clientId: string): { lastSyncAt: string | null; lastSyncStatus: string | null; failStreak: number } {
  const runs = db
    .select({ status: syncRunsTable.status, completedAt: syncRunsTable.completedAt, startedAt: syncRunsTable.startedAt })
    .from(syncRunsTable)
    .where(
      and(
        eq(syncRunsTable.clientId, clientId),
        sql`${syncRunsTable.kind} IN ('gsc-sync','gsc-backfill')`
      )
    )
    .orderBy(desc(syncRunsTable.startedAt))
    .limit(20)
    .all();

  let failStreak = 0;
  for (const run of runs) {
    if (run.status === "failed") {
      failStreak += 1;
    } else {
      break;
    }
  }

  const lastCompleted = runs.find((run) => run.status === "completed");
  return {
    lastSyncAt: lastCompleted?.completedAt ?? null,
    lastSyncStatus: runs[0]?.status ?? null,
    failStreak
  };
}

/** Queries with real volume sitting just off page one, last 28 days. */
function strikingDistanceCount(clientId: string): number {
  const end = todayInGscZone();
  const start = addDays(end, -27);
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(
      db
        .select({
          query: gscDailyTable.query,
          impressions: sql<number>`SUM(${gscDailyTable.impressions})`.as("impr"),
          position: sql<number>`SUM(${gscDailyTable.position} * ${gscDailyTable.impressions}) / SUM(${gscDailyTable.impressions})`.as("pos")
        })
        .from(gscDailyTable)
        .where(and(eq(gscDailyTable.clientId, clientId), gte(gscDailyTable.date, start), lte(gscDailyTable.date, end)))
        .groupBy(gscDailyTable.query)
        .having(sql`impr >= 50 AND pos >= 4 AND pos <= 20`)
        .as("striking")
    )
    .get();
  return Number(row?.n ?? 0);
}

export function gatherSnapshot(now: Date = new Date()): OperatorSnapshot {
  const clients = new ClientRepository().listClients();
  const google = new GoogleAccountRepository().getStatus();
  const today = todayInGscZone(now);

  const providers = rankConfig.serpProviderChain.map((name) =>
    describeBudget(name, rankConfig.monthlyFree[name] ?? 0, now)
  );

  const oldest = db.select({ d: sql<string | null>`MIN(${gscDailyTable.date})` }).from(gscDailyTable).get();

  const clientSnapshots: ClientSnapshot[] = clients
    .filter((client) => !client.archivedAt)
    .map((client) => {
      const sync = syncHealth(client.id);
      const bounds = getDateBounds(client.id);
      const checkHealth = getCheckHealth(client.id, addDays(today, -7));
      const totalChecks = checkHealth.ok + checkHealth.notFound + checkHealth.blocked + checkHealth.error;
      const coverage = getCoverage(client.id, addDays(today, -27), today);

      return {
        id: client.id,
        name: client.name,
        slug: client.slug,
        gscProperty: client.gscProperty,
        lastSyncAt: sync.lastSyncAt,
        lastSyncStatus: sync.lastSyncStatus,
        syncFailStreak: sync.failStreak,
        latestGscDate: bounds.latest,
        staleGscDays: bounds.latest ? Math.max(0, dayDiff(bounds.latest, today)) : null,
        checkHealth,
        blockedRate: totalChecks > 0 ? (checkHealth.blocked + checkHealth.error) / totalChecks : 0,
        coverageRatio: coverage.totalClicks > 0 ? coverage.coverageRatio : null,
        strikingDistanceCount: client.gscProperty ? strikingDistanceCount(client.id) : 0
      };
    });

  const emailState = emailStatus();

  return {
    takenAt: now.toISOString(),
    google: {
      connected: google.connected,
      needsReconnect: google.needsReconnect,
      lastErrorMessage: google.lastErrorMessage
    },
    providers,
    scheduler: { enabled: rankConfig.schedulerEnabled },
    email: { enabled: emailState.enabled, configured: emailState.configured, to: emailState.to },
    db: {
      sizeBytes: fileSize(rankConfig.dbPath),
      gscDailyRows: Number(db.select({ n: sql<number>`COUNT(*)` }).from(gscDailyTable).get()?.n ?? 0),
      oldestGscDate: oldest?.d ?? null
    },
    stuckSyncRuns: countRunning(syncRunsTable),
    stuckInsights: countRunning(insightsTable),
    clients: clientSnapshots
  };
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
function dayDiff(a: string, b: string): number {
  const toUtc = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
