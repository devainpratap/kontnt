import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type {
  CreateKeywordInput,
  ImportKeywordsResult,
  KeywordRecord,
  KeywordWithStatus,
  RankCheckRecord
} from "@rankos/shared";

import { db } from "../db/client";
import { gscDailyTable, keywordsTable, rankChecksTable } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { parseKeywordImport } from "./parse-import";
import { countCompetingPages, type CandidateRow } from "./opportunity";

type KeywordRow = typeof keywordsTable.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function safeParseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function toRecord(row: KeywordRow): KeywordRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    phrase: row.phrase,
    country: row.country,
    device: row.device,
    location: row.location,
    targetUrl: row.targetUrl,
    tags: safeParseTags(row.tags),
    cadence: row.cadence,
    isActive: row.isActive,
    createdAt: row.createdAt
  };
}

/** Same normalisation the importer applies, so lookups always agree. */
export function normalisePhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export class KeywordRepository {
  listKeywords(clientId: string): KeywordRecord[] {
    return db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, clientId))
      .orderBy(asc(keywordsTable.phrase))
      .all()
      .map(toRecord);
  }

  /**
   * Keywords with their latest check and the matching Search Console figures.
   *
   * The two position columns stay separate on purpose: GSC average position and
   * a tracked SERP rank measure different things and are never blended.
   */
  listWithStatus(clientId: string, gscWindow: { startDate: string; endDate: string }): KeywordWithStatus[] {
    const keywords = this.listKeywords(clientId);
    if (keywords.length === 0) {
      return [];
    }

    const ids = keywords.map((keyword) => keyword.id);

    // Latest check per keyword, in one pass rather than one query per keyword.
    const latestByKeyword = new Map<string, RankCheckRecord>();
    for (const row of db
      .select()
      .from(rankChecksTable)
      .where(inArray(rankChecksTable.keywordId, ids))
      .orderBy(desc(rankChecksTable.checkedAt))
      .all()) {
      if (!latestByKeyword.has(row.keywordId)) {
        latestByKeyword.set(row.keywordId, row as RankCheckRecord);
      }
    }

    const gscByPhrase = new Map<string, { position: number; impressions: number }>();
    for (const row of db
      .select({
        query: gscDailyTable.query,
        impressions: sql<number>`SUM(${gscDailyTable.impressions})`,
        weighted: sql<number>`SUM(${gscDailyTable.position} * ${gscDailyTable.impressions})`
      })
      .from(gscDailyTable)
      .where(
        and(
          eq(gscDailyTable.clientId, clientId),
          gte(gscDailyTable.date, gscWindow.startDate),
          lte(gscDailyTable.date, gscWindow.endDate)
        )
      )
      .groupBy(gscDailyTable.query)
      .all()) {
      const impressions = Number(row.impressions ?? 0);
      gscByPhrase.set(normalisePhrase(row.query), {
        impressions,
        position: impressions > 0 ? Number(row.weighted ?? 0) / impressions : 0
      });
    }

    return keywords.map((keyword) => {
      const gsc = gscByPhrase.get(normalisePhrase(keyword.phrase));
      return {
        ...keyword,
        latestCheck: latestByKeyword.get(keyword.id) ?? null,
        gscPosition: gsc ? gsc.position : null,
        gscImpressions: gsc ? gsc.impressions : null
      };
    });
  }

  getKeywordOrThrow(keywordId: string): KeywordRecord {
    const row = db.select().from(keywordsTable).where(eq(keywordsTable.id, keywordId)).get();
    if (!row) {
      throw new ApiError(`Keyword not found: ${keywordId}`, 404, "KEYWORD_NOT_FOUND");
    }
    return toRecord(row);
  }

  /** Tracked phrases for this client, used to keep suggestions from repeating. */
  trackedPhrases(clientId: string): string[] {
    return db
      .select({ phrase: keywordsTable.phrase })
      .from(keywordsTable)
      .where(eq(keywordsTable.clientId, clientId))
      .all()
      .map((row) => row.phrase);
  }

  createKeyword(clientId: string, input: CreateKeywordInput): KeywordRecord {
    const phrase = normalisePhrase(input.phrase);
    const existing = db
      .select()
      .from(keywordsTable)
      .where(
        and(
          eq(keywordsTable.clientId, clientId),
          eq(keywordsTable.phrase, phrase),
          eq(keywordsTable.country, input.country),
          eq(keywordsTable.device, input.device)
        )
      )
      .all()
      .find((row) => (row.location ?? null) === (input.location ?? null));

    if (existing) {
      throw new ApiError("That keyword is already tracked for this market.", 409, "KEYWORD_EXISTS");
    }

    const id = randomUUID();
    db.insert(keywordsTable)
      .values({
        id,
        clientId,
        phrase,
        country: input.country,
        device: input.device,
        location: input.location ?? null,
        targetUrl: input.targetUrl ?? null,
        tags: JSON.stringify(input.tags),
        cadence: input.cadence,
        isActive: true,
        createdAt: nowIso()
      })
      .run();

    return this.getKeywordOrThrow(id);
  }

  /**
   * Bulk import. Rows that collide with an existing keyword are counted as
   * duplicates rather than erroring, so re-pasting a longer list is safe and
   * does not double the eventual scrape volume.
   */
  importKeywords(
    clientId: string,
    raw: string,
    defaults: Omit<CreateKeywordInput, "phrase" | "targetUrl">
  ): ImportKeywordsResult {
    const parsed = parseKeywordImport(raw);

    const existing = new Set(
      db
        .select({ phrase: keywordsTable.phrase, country: keywordsTable.country, device: keywordsTable.device, location: keywordsTable.location })
        .from(keywordsTable)
        .where(eq(keywordsTable.clientId, clientId))
        .all()
        .map((row) => `${row.phrase}|${row.country}|${row.device}|${row.location ?? ""}`)
    );

    const timestamp = nowIso();
    const toInsert: Array<typeof keywordsTable.$inferInsert> = [];
    let duplicates = 0;

    for (const row of parsed.rows) {
      const key = `${row.phrase}|${defaults.country}|${defaults.device}|${defaults.location ?? ""}`;
      if (existing.has(key)) {
        duplicates += 1;
        continue;
      }
      existing.add(key);

      toInsert.push({
        id: randomUUID(),
        clientId,
        phrase: row.phrase,
        country: defaults.country,
        device: defaults.device,
        location: defaults.location ?? null,
        targetUrl: row.targetUrl,
        tags: JSON.stringify(defaults.tags),
        cadence: defaults.cadence,
        isActive: true,
        createdAt: timestamp
      });
    }

    if (toInsert.length > 0) {
      db.transaction((tx) => {
        // 11 bound values per row; 80 keeps each statement inside SQLite's limit.
        for (let index = 0; index < toInsert.length; index += 80) {
          tx.insert(keywordsTable).values(toInsert.slice(index, index + 80)).run();
        }
      });
    }

    return { created: toInsert.length, duplicates, invalid: parsed.invalid };
  }

  updateKeyword(
    keywordId: string,
    patch: Partial<Pick<KeywordRecord, "targetUrl" | "tags" | "cadence" | "isActive">>
  ): KeywordRecord {
    this.getKeywordOrThrow(keywordId);

    const values: Partial<typeof keywordsTable.$inferInsert> = {};
    if (patch.targetUrl !== undefined) values.targetUrl = patch.targetUrl;
    if (patch.tags !== undefined) values.tags = JSON.stringify(patch.tags);
    if (patch.cadence !== undefined) values.cadence = patch.cadence;
    if (patch.isActive !== undefined) values.isActive = patch.isActive;

    if (Object.keys(values).length > 0) {
      db.update(keywordsTable).set(values).where(eq(keywordsTable.id, keywordId)).run();
    }

    return this.getKeywordOrThrow(keywordId);
  }

  /**
   * Hard-deletes the keyword and its check history.
   *
   * Unlike clients, an untracked keyword has no reporting value and keeping
   * orphaned checks would inflate the data-health counts.
   */
  deleteKeyword(keywordId: string): void {
    this.getKeywordOrThrow(keywordId);
    db.transaction((tx) => {
      tx.delete(rankChecksTable).where(eq(rankChecksTable.keywordId, keywordId)).run();
      tx.delete(keywordsTable).where(eq(keywordsTable.id, keywordId)).run();
    });
  }

  /**
   * Aggregate Search Console queries into suggestion candidates.
   *
   * pageCount and topPage come from the same pass, so cannibalization is
   * detected without a second query.
   */
  suggestionCandidates(
    clientId: string,
    window: { startDate: string; endDate: string }
  ): CandidateRow[] {
    const rows = db
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
          gte(gscDailyTable.date, window.startDate),
          lte(gscDailyTable.date, window.endDate)
        )
      )
      .groupBy(gscDailyTable.query, gscDailyTable.page)
      .all();

    const byQuery = new Map<
      string,
      {
        clicks: number;
        impressions: number;
        weighted: number;
        /** Per page: impressions (for competition) and a rank score (for the target URL). */
        pages: Map<string, { impressions: number; score: number }>;
      }
    >();

    for (const row of rows) {
      const entry = byQuery.get(row.query) ?? {
        clicks: 0,
        impressions: 0,
        weighted: 0,
        pages: new Map<string, { impressions: number; score: number }>()
      };

      const clicks = Number(row.clicks ?? 0);
      const impressions = Number(row.impressions ?? 0);

      entry.clicks += clicks;
      entry.impressions += impressions;
      entry.weighted += Number(row.weighted ?? 0);

      const page = entry.pages.get(row.page) ?? { impressions: 0, score: 0 };
      page.impressions += impressions;
      // Rank candidate pages by clicks, falling back to impressions so a
      // zero-click query still reports a sensible target URL.
      page.score += clicks * 1000 + impressions;
      entry.pages.set(row.page, page);

      byQuery.set(row.query, entry);
    }

    return [...byQuery.entries()].map(([query, entry]) => {
      const pages = [...entry.pages.entries()];
      const topPage = pages.sort((a, b) => b[1].score - a[1].score)[0]?.[0] ?? "";

      return {
        query,
        clicks: entry.clicks,
        impressions: entry.impressions,
        position: entry.impressions > 0 ? entry.weighted / entry.impressions : 0,
        // Only meaningfully-competing pages count, so a URL that surfaced on
        // three days with five impressions is not reported as cannibalization.
        pageCount: countCompetingPages(pages.map(([, value]) => value.impressions)),
        topPage
      };
    });
  }
}
