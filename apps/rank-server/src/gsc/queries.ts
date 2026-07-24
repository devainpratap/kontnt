import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { GSC_PROVISIONAL_DAYS } from "@rankos/shared";

import { db } from "../db/client";
import { gscDailyTable, gscDailyTotalsTable, syncRunsTable } from "../db/schema";
import { isProvisional } from "./date-utils";

/**
 * Read-side queries for the Search Console dashboard.
 *
 * Everything here reads from gsc_daily_totals for headline numbers and
 * gsc_daily for breakdowns, and every response carries enough context for the
 * UI to be honest: which days are still being revised, and how much of the
 * traffic Google actually attributed to named queries.
 */

export type DailyPoint = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** True while Google is still revising this day. Charted dashed, not solid. */
  provisional: boolean;
};

export type QueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type CoverageSummary = {
  totalClicks: number;
  attributedClicks: number;
  /** 0-1. Google withholds rare queries, so this is never expected to be 1. */
  coverageRatio: number;
};

export type DateBounds = { earliest: string | null; latest: string | null };

export function getDateBounds(clientId: string): DateBounds {
  const row = db
    .select({
      earliest: sql<string | null>`MIN(${gscDailyTotalsTable.date})`,
      latest: sql<string | null>`MAX(${gscDailyTotalsTable.date})`
    })
    .from(gscDailyTotalsTable)
    .where(eq(gscDailyTotalsTable.clientId, clientId))
    .get();

  return { earliest: row?.earliest ?? null, latest: row?.latest ?? null };
}

/** Daily totals for the trend chart, with provisional days flagged. */
export function getDailyTotals(clientId: string, startDate: string, endDate: string): DailyPoint[] {
  const { latest } = getDateBounds(clientId);

  return db
    .select()
    .from(gscDailyTotalsTable)
    .where(
      and(
        eq(gscDailyTotalsTable.clientId, clientId),
        gte(gscDailyTotalsTable.date, startDate),
        lte(gscDailyTotalsTable.date, endDate)
      )
    )
    .orderBy(gscDailyTotalsTable.date)
    .all()
    .map((row) => ({
      date: row.date,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      provisional: latest ? isProvisional(row.date, latest, GSC_PROVISIONAL_DAYS) : false
    }));
}

/**
 * Summed KPIs for a window.
 *
 * Position is impression-weighted, matching how Google computes it. Summing
 * or flat-averaging daily positions would produce a number that disagrees with
 * the Search Console UI and destroy trust in the dashboard.
 */
export function getTotals(clientId: string, startDate: string, endDate: string) {
  const row = db
    .select({
      clicks: sql<number>`COALESCE(SUM(${gscDailyTotalsTable.clicks}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${gscDailyTotalsTable.impressions}), 0)`,
      weightedPosition: sql<number>`COALESCE(SUM(${gscDailyTotalsTable.position} * ${gscDailyTotalsTable.impressions}), 0)`,
      days: sql<number>`COUNT(*)`
    })
    .from(gscDailyTotalsTable)
    .where(
      and(
        eq(gscDailyTotalsTable.clientId, clientId),
        gte(gscDailyTotalsTable.date, startDate),
        lte(gscDailyTotalsTable.date, endDate)
      )
    )
    .get();

  const clicks = Number(row?.clicks ?? 0);
  const impressions = Number(row?.impressions ?? 0);

  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? Number(row?.weightedPosition ?? 0) / impressions : null,
    days: Number(row?.days ?? 0)
  };
}

export function getTopQueries(clientId: string, startDate: string, endDate: string, limit = 100): QueryRow[] {
  return db
    .select({
      query: gscDailyTable.query,
      clicks: sql<number>`SUM(${gscDailyTable.clicks})`,
      impressions: sql<number>`SUM(${gscDailyTable.impressions})`,
      weightedPosition: sql<number>`SUM(${gscDailyTable.position} * ${gscDailyTable.impressions})`
    })
    .from(gscDailyTable)
    .where(
      and(eq(gscDailyTable.clientId, clientId), gte(gscDailyTable.date, startDate), lte(gscDailyTable.date, endDate))
    )
    .groupBy(gscDailyTable.query)
    .orderBy(desc(sql`SUM(${gscDailyTable.clicks})`))
    .limit(limit)
    .all()
    .map((row) => {
      const clicks = Number(row.clicks ?? 0);
      const impressions = Number(row.impressions ?? 0);
      return {
        query: row.query,
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0 ? Number(row.weightedPosition ?? 0) / impressions : 0
      };
    });
}

export function getTopPages(clientId: string, startDate: string, endDate: string, limit = 100): PageRow[] {
  return db
    .select({
      page: gscDailyTable.page,
      clicks: sql<number>`SUM(${gscDailyTable.clicks})`,
      impressions: sql<number>`SUM(${gscDailyTable.impressions})`,
      weightedPosition: sql<number>`SUM(${gscDailyTable.position} * ${gscDailyTable.impressions})`
    })
    .from(gscDailyTable)
    .where(
      and(eq(gscDailyTable.clientId, clientId), gte(gscDailyTable.date, startDate), lte(gscDailyTable.date, endDate))
    )
    .groupBy(gscDailyTable.page)
    .orderBy(desc(sql`SUM(${gscDailyTable.clicks})`))
    .limit(limit)
    .all()
    .map((row) => {
      const clicks = Number(row.clicks ?? 0);
      const impressions = Number(row.impressions ?? 0);
      return {
        page: row.page,
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0 ? Number(row.weightedPosition ?? 0) / impressions : 0
      };
    });
}

/**
 * How much of the property's traffic is attributable to named queries.
 *
 * Google filters rare queries out of the query dimension for privacy, so the
 * breakdown always understates the total. Surfacing the ratio turns a
 * "your numbers don't add up" credibility problem into a stated fact.
 */
export function getCoverage(clientId: string, startDate: string, endDate: string): CoverageSummary {
  const totals = db
    .select({ clicks: sql<number>`COALESCE(SUM(${gscDailyTotalsTable.clicks}), 0)` })
    .from(gscDailyTotalsTable)
    .where(
      and(
        eq(gscDailyTotalsTable.clientId, clientId),
        gte(gscDailyTotalsTable.date, startDate),
        lte(gscDailyTotalsTable.date, endDate)
      )
    )
    .get();

  const attributed = db
    .select({ clicks: sql<number>`COALESCE(SUM(${gscDailyTable.clicks}), 0)` })
    .from(gscDailyTable)
    .where(
      and(eq(gscDailyTable.clientId, clientId), gte(gscDailyTable.date, startDate), lte(gscDailyTable.date, endDate))
    )
    .get();

  const totalClicks = Number(totals?.clicks ?? 0);
  const attributedClicks = Number(attributed?.clicks ?? 0);

  return {
    totalClicks,
    attributedClicks,
    coverageRatio: totalClicks > 0 ? Math.min(attributedClicks / totalClicks, 1) : 0
  };
}

export function getRecentRuns(clientId: string, limit = 10) {
  return db
    .select()
    .from(syncRunsTable)
    .where(eq(syncRunsTable.clientId, clientId))
    .orderBy(desc(syncRunsTable.startedAt))
    .limit(limit)
    .all();
}
