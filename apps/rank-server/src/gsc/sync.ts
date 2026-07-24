import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import type { SyncRunKind } from "@rankos/shared";

import { buildClientPaths, writeJsonFile } from "../clients/files";
import { ClientRepository } from "../clients/repository";
import { rankConfig } from "../config";
import { db } from "../db/client";
import { gscDailyTable, gscDailyTotalsTable, gscWeeklyRollupTable, syncRunsTable } from "../db/schema";
import { GoogleAccountRepository } from "../google/account-repository";
import { ApiError } from "../lib/api-error";
import { queryAllRows, type SearchAnalyticsRow } from "./api-client";
import { backfillWindow, rollingWindow, startOfWeek } from "./date-utils";

/**
 * The Search Console sync.
 *
 * The single property that matters: running it twice over the same window must
 * leave the database identical. Google revises the most recent days after
 * publishing them, so an append-only sync would bake in provisional numbers
 * forever and double-count on every re-run. Every write here is an upsert
 * keyed on the natural identity of the row.
 */

export type SyncOptions = {
  clientId: string;
  startDate?: string;
  endDate?: string;
  kind?: SyncRunKind;
  signal?: AbortSignal;
};

export type SyncResult = {
  runId: string;
  clientId: string;
  startDate: string;
  endDate: string;
  rowsWritten: number;
  totalsRowsWritten: number;
  weeksRolledUp: number;
  status: "completed" | "failed";
  errorMessage: string | null;
};

// SQLite caps variables per statement (999 on older builds). Each gsc_daily row
// binds 11 values, so 80 rows per statement stays comfortably inside it.
const DAILY_CHUNK_SIZE = 80;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export class GscSyncService {
  constructor(
    private readonly clients = new ClientRepository(),
    private readonly google = new GoogleAccountRepository()
  ) {}

  private startRun(clientId: string, kind: SyncRunKind): string {
    const runId = randomUUID();
    db.insert(syncRunsTable)
      .values({
        id: runId,
        clientId,
        kind,
        status: "running",
        startedAt: new Date().toISOString(),
        completedAt: null,
        rowsWritten: 0,
        itemsOk: 0,
        itemsBlocked: 0,
        itemsFailed: 0,
        errorMessage: null
      })
      .run();
    return runId;
  }

  private finishRun(
    runId: string,
    status: "completed" | "partial" | "failed",
    rowsWritten: number,
    errorMessage: string | null
  ): void {
    db.update(syncRunsTable)
      .set({
        status,
        completedAt: new Date().toISOString(),
        rowsWritten,
        itemsOk: status === "completed" ? 1 : 0,
        itemsFailed: status === "failed" ? 1 : 0,
        errorMessage
      })
      .where(sql`${syncRunsTable.id} = ${runId}`)
      .run();
  }

  /**
   * Upsert query x page rows.
   *
   * onConflictDoUpdate against the natural key is what makes the rolling
   * re-pull idempotent: a revised day overwrites its previous values instead of
   * inserting a duplicate. Public so tests can assert that property directly.
   */
  writeDailyRows(clientId: string, rows: SearchAnalyticsRow[]): number {
    if (rows.length === 0) {
      return 0;
    }

    const values = rows.map((row) => {
      const [date, query, page] = row.keys;
      return {
        id: randomUUID(),
        clientId,
        date,
        query,
        page,
        device: "ALL",
        country: "ALL",
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr: row.ctr ?? 0,
        position: row.position ?? 0
      };
    });

    let written = 0;
    // One transaction for the whole window: a mid-sync crash leaves no
    // half-written day rather than a silently partial one.
    db.transaction((tx) => {
      for (const batch of chunk(values, DAILY_CHUNK_SIZE)) {
        tx.insert(gscDailyTable)
          .values(batch)
          .onConflictDoUpdate({
            target: [
              gscDailyTable.clientId,
              gscDailyTable.date,
              gscDailyTable.query,
              gscDailyTable.page,
              gscDailyTable.device,
              gscDailyTable.country
            ],
            set: {
              clicks: sql`excluded.clicks`,
              impressions: sql`excluded.impressions`,
              ctr: sql`excluded.ctr`,
              position: sql`excluded.position`
            }
          })
          .run();
        written += batch.length;
      }
    });

    return written;
  }

  /**
   * Upsert unfiltered per-day totals.
   *
   * Google omits rare queries from the query breakdown for privacy, so the
   * query rows never sum to the property total. Storing the real totals lets
   * the UI report attribution coverage honestly instead of quietly
   * under-reporting every client's traffic. Public so tests can drive it.
   */
  writeTotals(clientId: string, rows: SearchAnalyticsRow[]): number {
    if (rows.length === 0) {
      return 0;
    }

    const values = rows.map((row) => ({
      id: randomUUID(),
      clientId,
      date: row.keys[0],
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0
    }));

    db.transaction((tx) => {
      for (const batch of chunk(values, 120)) {
        tx.insert(gscDailyTotalsTable)
          .values(batch)
          .onConflictDoUpdate({
            target: [gscDailyTotalsTable.clientId, gscDailyTotalsTable.date],
            set: {
              clicks: sql`excluded.clicks`,
              impressions: sql`excluded.impressions`,
              ctr: sql`excluded.ctr`,
              position: sql`excluded.position`
            }
          })
          .run();
      }
    });

    return values.length;
  }

  /**
   * Rebuild weekly rollups for the affected weeks.
   *
   * Charts read this table rather than scanning millions of gsc_daily rows.
   * Position is impression-weighted, because a flat average across days would
   * let a single low-impression day swing the number.
   */
  rebuildWeeklyRollups(clientId: string, dates: string[]): number {
    const weeks = [...new Set(dates.map(startOfWeek))];
    if (weeks.length === 0) {
      return 0;
    }

    db.transaction((tx) => {
      for (const weekStart of weeks) {
        const weekEnd = new Date(Date.UTC(
          Number(weekStart.slice(0, 4)),
          Number(weekStart.slice(5, 7)) - 1,
          Number(weekStart.slice(8, 10)) + 6
        ))
          .toISOString()
          .slice(0, 10);

        tx.delete(gscWeeklyRollupTable)
          .where(sql`${gscWeeklyRollupTable.clientId} = ${clientId} AND ${gscWeeklyRollupTable.weekStart} = ${weekStart}`)
          .run();

        tx.run(sql`
          INSERT INTO gsc_weekly_rollup (id, client_id, week_start, query, clicks, impressions, avg_position)
          SELECT
            lower(hex(randomblob(16))),
            client_id,
            ${weekStart},
            query,
            SUM(clicks),
            SUM(impressions),
            CASE WHEN SUM(impressions) > 0
                 THEN SUM(position * impressions) / SUM(impressions)
                 ELSE 0 END
          FROM gsc_daily
          WHERE client_id = ${clientId} AND date >= ${weekStart} AND date <= ${weekEnd}
          GROUP BY client_id, query
        `);
      }
    });

    return weeks.length;
  }

  /** Sync one client over an explicit or rolling window. */
  async syncClient(options: SyncOptions): Promise<SyncResult> {
    const client = this.clients.getClientOrThrow(options.clientId);

    if (!client.gscProperty) {
      throw new ApiError(
        `Client "${client.name}" has no Search Console property linked.`,
        400,
        "CLIENT_NO_GSC_PROPERTY"
      );
    }

    const kind: SyncRunKind = options.kind ?? "gsc-sync";
    const window =
      options.startDate && options.endDate
        ? { startDate: options.startDate, endDate: options.endDate }
        : rollingWindow(rankConfig.gscRollingWindowDays);

    const runId = this.startRun(client.id, kind);

    try {
      const accessToken = await this.google.getAccessToken();
      const fetchOptions = { accessToken, signal: options.signal };

      // Two passes over the same window: the query x page breakdown, and the
      // unfiltered totals that the breakdown structurally cannot reproduce.
      const detailRows = await queryAllRows(
        client.gscProperty,
        {
          startDate: window.startDate,
          endDate: window.endDate,
          dimensions: ["date", "query", "page"]
        },
        fetchOptions
      );

      const totalsRows = await queryAllRows(
        client.gscProperty,
        {
          startDate: window.startDate,
          endDate: window.endDate,
          dimensions: ["date"]
        },
        fetchOptions
      );

      const rowsWritten = this.writeDailyRows(client.id, detailRows);
      const totalsRowsWritten = this.writeTotals(client.id, totalsRows);

      const touchedDates = [...new Set(detailRows.map((row) => row.keys[0]))];
      const weeksRolledUp = this.rebuildWeeklyRollups(client.id, touchedDates);

      // Raw payload to disk, so SQLite stays a rebuildable index rather than
      // the only copy of the data.
      await this.snapshotToDisk(client.clientPath, window, detailRows, totalsRows);

      this.finishRun(runId, "completed", rowsWritten, null);

      return {
        runId,
        clientId: client.id,
        startDate: window.startDate,
        endDate: window.endDate,
        rowsWritten,
        totalsRowsWritten,
        weeksRolledUp,
        status: "completed",
        errorMessage: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync failure.";
      this.finishRun(runId, "failed", 0, message);
      throw error;
    }
  }

  private async snapshotToDisk(
    clientPath: string,
    window: { startDate: string; endDate: string },
    detailRows: SearchAnalyticsRow[],
    totalsRows: SearchAnalyticsRow[]
  ): Promise<void> {
    const paths = buildClientPaths(clientPath);
    await writeJsonFile(join(paths.gscDir, `${window.startDate}_to_${window.endDate}.json`), {
      window,
      fetchedAt: new Date().toISOString(),
      detailRowCount: detailRows.length,
      totalsRowCount: totalsRows.length,
      detail: detailRows,
      totals: totalsRows
    });
  }

  /** Full historical pull. Search Console retains roughly 16 months. */
  async backfillClient(clientId: string, signal?: AbortSignal): Promise<SyncResult> {
    const window = backfillWindow(rankConfig.gscBackfillMonths);
    return this.syncClient({
      clientId,
      startDate: window.startDate,
      endDate: window.endDate,
      kind: "gsc-backfill",
      signal
    });
  }
}
