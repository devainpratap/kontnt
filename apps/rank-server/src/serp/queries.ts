import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "../db/client";
import { keywordsTable, rankChecksTable, serpResultsTable } from "../db/schema";

/**
 * Read-side queries for tracked ranks.
 *
 * Every shape here preserves the ok / not-found / blocked / error distinction
 * all the way to the client. The UI needs it to draw a gap rather than a drop,
 * so it must never be flattened into a nullable number on the way out.
 */

export type PositionPoint = {
  date: string;
  status: "ok" | "not-found" | "blocked" | "error";
  /** Non-null only when status is "ok". */
  position: number | null;
  rankingUrl: string | null;
};

/** Position history for one keyword, oldest first. */
export function getPositionHistory(keywordId: string, limit = 180): PositionPoint[] {
  return db
    .select({
      date: rankChecksTable.checkedDate,
      status: rankChecksTable.status,
      position: rankChecksTable.position,
      rankingUrl: rankChecksTable.rankingUrl
    })
    .from(rankChecksTable)
    .where(eq(rankChecksTable.keywordId, keywordId))
    .orderBy(desc(rankChecksTable.checkedDate))
    .limit(limit)
    .all()
    .reverse()
    .map((row) => ({
      date: row.date,
      status: row.status,
      // Defensive: a stored position on a non-ok row would be a bug upstream,
      // and surfacing it would defeat the entire gap-not-drop guarantee.
      position: row.status === "ok" ? row.position : null,
      rankingUrl: row.rankingUrl
    }));
}

/** The stored top-N for a keyword's most recent successful check. */
export function getLatestSerp(keywordId: string) {
  const latest = db
    .select({ id: rankChecksTable.id, checkedAt: rankChecksTable.checkedAt })
    .from(rankChecksTable)
    .where(and(eq(rankChecksTable.keywordId, keywordId), eq(rankChecksTable.status, "ok")))
    .orderBy(desc(rankChecksTable.checkedAt))
    .limit(1)
    .get();

  if (!latest) {
    return { checkedAt: null, results: [] };
  }

  return {
    checkedAt: latest.checkedAt,
    results: db
      .select()
      .from(serpResultsTable)
      .where(eq(serpResultsTable.rankCheckId, latest.id))
      .orderBy(serpResultsTable.position)
      .all()
  };
}

/**
 * Which domains occupy this client's tracked SERPs most often.
 *
 * Computed from stored results, so it costs nothing extra — the pages were
 * already fetched for the rank check.
 */
export function getShareOfSerp(clientId: string, sinceDate: string, limit = 15) {
  return db
    .select({
      domain: serpResultsTable.domain,
      appearances: sql<number>`COUNT(*)`,
      bestPosition: sql<number>`MIN(${serpResultsTable.position})`,
      avgPosition: sql<number>`AVG(${serpResultsTable.position})`,
      isClient: sql<number>`MAX(${serpResultsTable.isClient})`
    })
    .from(serpResultsTable)
    .innerJoin(rankChecksTable, eq(rankChecksTable.id, serpResultsTable.rankCheckId))
    .innerJoin(keywordsTable, eq(keywordsTable.id, rankChecksTable.keywordId))
    .where(
      and(
        eq(keywordsTable.clientId, clientId),
        eq(rankChecksTable.status, "ok"),
        gte(rankChecksTable.checkedDate, sinceDate)
      )
    )
    .groupBy(serpResultsTable.domain)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(limit)
    .all()
    .map((row) => ({
      domain: row.domain,
      appearances: Number(row.appearances ?? 0),
      bestPosition: Number(row.bestPosition ?? 0),
      avgPosition: Number(row.avgPosition ?? 0),
      isClient: Boolean(row.isClient)
    }));
}

/**
 * Check health over a window.
 *
 * Surfacing blocked and failed counts is what makes a degrading scraper
 * visible. Without it, a run that checked nothing successfully looks the same
 * as one that found no rankings.
 */
export function getCheckHealth(clientId: string, sinceDate: string) {
  const rows = db
    .select({ status: rankChecksTable.status, count: sql<number>`COUNT(*)` })
    .from(rankChecksTable)
    .innerJoin(keywordsTable, eq(keywordsTable.id, rankChecksTable.keywordId))
    .where(and(eq(keywordsTable.clientId, clientId), gte(rankChecksTable.checkedDate, sinceDate)))
    .groupBy(rankChecksTable.status)
    .all();

  const health = { ok: 0, notFound: 0, blocked: 0, error: 0 };
  for (const row of rows) {
    const count = Number(row.count ?? 0);
    if (row.status === "ok") health.ok += count;
    else if (row.status === "not-found") health.notFound += count;
    else if (row.status === "blocked") health.blocked += count;
    else health.error += count;
  }

  return health;
}

/** Keywords plus their last check time, for cadence selection. */
export function getKeywordsWithLastCheck(clientId: string) {
  const lastChecks = new Map<string, string>();

  for (const row of db
    .select({
      keywordId: rankChecksTable.keywordId,
      lastAt: sql<string | null>`MAX(${rankChecksTable.checkedAt})`
    })
    .from(rankChecksTable)
    .innerJoin(keywordsTable, eq(keywordsTable.id, rankChecksTable.keywordId))
    .where(eq(keywordsTable.clientId, clientId))
    .groupBy(rankChecksTable.keywordId)
    .all()) {
    if (row.lastAt) {
      lastChecks.set(row.keywordId, row.lastAt);
    }
  }

  return db
    .select()
    .from(keywordsTable)
    .where(eq(keywordsTable.clientId, clientId))
    .all()
    .map((row) => ({
      ...row,
      tags: JSON.parse(row.tags || "[]") as string[],
      lastCheckedAt: lastChecks.get(row.id) ?? null
    }));
}
