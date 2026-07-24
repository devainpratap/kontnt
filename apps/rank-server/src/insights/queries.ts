import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "../db/client";
import { gscDailyTable } from "../db/schema";
import type { PagePeriodRow, QueryPeriodRow } from "./stats";

/**
 * Period aggregations feeding the insight engine.
 *
 * Position is impression-weighted everywhere, matching how Google computes it.
 * A flat average across days would disagree with the Search Console UI, and a
 * report whose numbers cannot be reconciled with Google is worthless to a
 * client.
 */

export function getQueryPeriod(clientId: string, startDate: string, endDate: string): QueryPeriodRow[] {
  return db
    .select({
      query: gscDailyTable.query,
      clicks: sql<number>`SUM(${gscDailyTable.clicks})`,
      impressions: sql<number>`SUM(${gscDailyTable.impressions})`,
      weighted: sql<number>`SUM(${gscDailyTable.position} * ${gscDailyTable.impressions})`
    })
    .from(gscDailyTable)
    .where(
      and(
        eq(gscDailyTable.clientId, clientId),
        gte(gscDailyTable.date, startDate),
        lte(gscDailyTable.date, endDate)
      )
    )
    .groupBy(gscDailyTable.query)
    .all()
    .map((row) => {
      const impressions = Number(row.impressions ?? 0);
      return {
        query: row.query,
        clicks: Number(row.clicks ?? 0),
        impressions,
        position: impressions > 0 ? Number(row.weighted ?? 0) / impressions : 0
      };
    });
}

export function getPagePeriod(clientId: string, startDate: string, endDate: string): PagePeriodRow[] {
  return db
    .select({
      page: gscDailyTable.page,
      clicks: sql<number>`SUM(${gscDailyTable.clicks})`,
      impressions: sql<number>`SUM(${gscDailyTable.impressions})`,
      weighted: sql<number>`SUM(${gscDailyTable.position} * ${gscDailyTable.impressions})`
    })
    .from(gscDailyTable)
    .where(
      and(
        eq(gscDailyTable.clientId, clientId),
        gte(gscDailyTable.date, startDate),
        lte(gscDailyTable.date, endDate)
      )
    )
    .groupBy(gscDailyTable.page)
    .all()
    .map((row) => {
      const impressions = Number(row.impressions ?? 0);
      return {
        page: row.page,
        clicks: Number(row.clicks ?? 0),
        impressions,
        position: impressions > 0 ? Number(row.weighted ?? 0) / impressions : 0
      };
    });
}

/**
 * Query x page pairs, for cannibalisation detection.
 *
 * Capped because a 90-day window on a large property produces hundreds of
 * thousands of pairs and only the high-impression ones can be cannibalised in
 * any meaningful sense.
 */
export function getQueryPageRows(
  clientId: string,
  startDate: string,
  endDate: string,
  limit = 5000
): Array<{ query: string; page: string; clicks: number; impressions: number; position: number }> {
  return db
    .select({
      query: gscDailyTable.query,
      page: gscDailyTable.page,
      clicks: sql<number>`SUM(${gscDailyTable.clicks})`,
      impressions: sql<number>`SUM(${gscDailyTable.impressions})`,
      weighted: sql<number>`SUM(${gscDailyTable.position} * ${gscDailyTable.impressions})`
    })
    .from(gscDailyTable)
    .where(
      and(
        eq(gscDailyTable.clientId, clientId),
        gte(gscDailyTable.date, startDate),
        lte(gscDailyTable.date, endDate)
      )
    )
    .groupBy(gscDailyTable.query, gscDailyTable.page)
    .orderBy(sql`SUM(${gscDailyTable.impressions}) DESC`)
    .limit(limit)
    .all()
    .map((row) => {
      const impressions = Number(row.impressions ?? 0);
      return {
        query: row.query,
        page: row.page,
        clicks: Number(row.clicks ?? 0),
        impressions,
        position: impressions > 0 ? Number(row.weighted ?? 0) / impressions : 0
      };
    });
}
