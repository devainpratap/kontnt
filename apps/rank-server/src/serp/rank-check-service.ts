import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { and, desc, eq, sql } from "drizzle-orm";

import type { KeywordRecord, RankCheckStatus } from "@rankos/shared";

import { buildClientPaths, keywordSnapshotDir, writeJsonFile } from "../clients/files";
import { ClientRepository } from "../clients/repository";
import { rankConfig } from "../config";
import { db } from "../db/client";
import { rankChecksTable, serpFeaturesTable, serpResultsTable, syncRunsTable } from "../db/schema";
import { todayInGscZone } from "../gsc/date-utils";
import { findClientPosition } from "./parser";
import { serpProvider } from "./provider";
import type { ChainResult } from "./provider-chain";
import { STORED_RESULT_COUNT, type SerpFetchResult } from "./types";

/**
 * Turning a SERP fetch into a stored rank check.
 *
 * The rule this module exists to enforce: a position is written only when the
 * fetch status is `ok`. A blocked or failed check stores `position = null` with
 * a status that says why, so the chart shows a gap. If a scraper failure were
 * ever recorded as "not in the top 100", the dashboard would report a Google
 * block to a client as a ranking collapse — the worst error this system could
 * make.
 */

export type CheckOutcome = {
  keywordId: string;
  phrase: string;
  status: RankCheckStatus;
  position: number | null;
  previousPosition: number | null;
  rankingUrl: string | null;
  errorMessage: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

export class RankCheckService {
  constructor(private readonly clients = new ClientRepository()) {}

  /**
   * The most recent *known* position for a keyword.
   *
   * Deliberately skips blocked and failed checks: a delta must always compare
   * two real observations, never a real one against an unknown.
   */
  lastKnownPosition(keywordId: string): number | null {
    const row = db
      .select({ position: rankChecksTable.position })
      .from(rankChecksTable)
      .where(and(eq(rankChecksTable.keywordId, keywordId), eq(rankChecksTable.status, "ok")))
      .orderBy(desc(rankChecksTable.checkedAt))
      .limit(1)
      .get();

    return row?.position ?? null;
  }

  /**
   * Persist one fetch.
   *
   * Upserts on (keyword, day, source) so re-running a check on the same day
   * corrects it rather than accumulating duplicates.
   */
  private async persist(
    keyword: KeywordRecord,
    clientDomain: string,
    clientPath: string,
    fetched: SerpFetchResult
  ): Promise<CheckOutcome> {
    // When the failover chain answered, attribute the check to the provider
    // that actually served it rather than to "chain" — a keyword's history must
    // stay honest about where each reading came from as the chain shifts.
    const sourceName = (fetched as ChainResult).usedProvider ?? serpProvider.name;
    const checkedAt = nowIso();
    const checkedDate = todayInGscZone();
    const previousPosition = this.lastKnownPosition(keyword.id);

    const match = fetched.status === "ok" ? findClientPosition(fetched.results, clientDomain) : null;

    // "ok" from the provider means the page was read. Whether the client is in
    // it decides between ok and not-found; neither is an error.
    const status: RankCheckStatus =
      fetched.status === "ok" ? (match ? "ok" : "not-found") : fetched.status;

    const rawPath = await this.writeSnapshot(clientPath, keyword, checkedAt, fetched, sourceName);

    const checkId = randomUUID();

    db.transaction((tx) => {
      tx.insert(rankChecksTable)
        .values({
          id: checkId,
          keywordId: keyword.id,
          checkedAt,
          checkedDate,
          source: sourceName as never,
          status,
          // Only ever set when the client was actually located in a page we read.
          position: match ? match.position : null,
          rankingUrl: match ? match.url : null,
          previousPosition,
          rawPath,
          errorMessage: fetched.errorMessage
        })
        .onConflictDoUpdate({
          target: [rankChecksTable.keywordId, rankChecksTable.checkedDate, rankChecksTable.source],
          set: {
            checkedAt,
            status,
            position: match ? match.position : null,
            rankingUrl: match ? match.url : null,
            previousPosition,
            rawPath,
            errorMessage: fetched.errorMessage
          }
        })
        .run();

      // Re-running a day replaces its stored SERP rather than appending to it.
      const existing = tx
        .select({ id: rankChecksTable.id })
        .from(rankChecksTable)
        .where(
          and(
            eq(rankChecksTable.keywordId, keyword.id),
            eq(rankChecksTable.checkedDate, checkedDate),
            eq(rankChecksTable.source, sourceName as never)
          )
        )
        .get();

      const storedId = existing?.id ?? checkId;

      tx.delete(serpResultsTable).where(eq(serpResultsTable.rankCheckId, storedId)).run();
      tx.delete(serpFeaturesTable).where(eq(serpFeaturesTable.rankCheckId, storedId)).run();

      // The full top-N is stored on every successful check, which is what makes
      // competitor tracking free — the page was already fetched.
      const top = fetched.results.slice(0, STORED_RESULT_COUNT);
      if (top.length > 0) {
        tx.insert(serpResultsTable)
          .values(
            top.map((item) => ({
              id: randomUUID(),
              rankCheckId: storedId,
              position: item.position,
              url: item.url,
              domain: item.domain,
              title: item.title,
              isClient: item.domain === clientDomain || item.domain.endsWith(`.${clientDomain}`)
            }))
          )
          .run();
      }

      if (fetched.features.length > 0) {
        tx.insert(serpFeaturesTable)
          .values(
            fetched.features.map((feature) => ({
              id: randomUUID(),
              rankCheckId: storedId,
              feature,
              present: true
            }))
          )
          .run();
      }
    });

    return {
      keywordId: keyword.id,
      phrase: keyword.phrase,
      status,
      position: match ? match.position : null,
      previousPosition,
      rankingUrl: match ? match.url : null,
      errorMessage: fetched.errorMessage
    };
  }

  /** Raw SERP to disk, so a run stays inspectable after the fact. */
  private async writeSnapshot(
    clientPath: string,
    keyword: KeywordRecord,
    checkedAt: string,
    fetched: SerpFetchResult,
    sourceName: string
  ): Promise<string | null> {
    try {
      const paths = buildClientPaths(clientPath);
      const dir = keywordSnapshotDir(paths, {
        phrase: keyword.phrase,
        country: keyword.country,
        device: keyword.device,
        location: keyword.location
      });
      await mkdir(dir, { recursive: true });

      const file = join(dir, `${checkedAt.replace(/[:.]/g, "-")}.json`);
      await writeJsonFile(file, {
        keyword: keyword.phrase,
        country: keyword.country,
        device: keyword.device,
        location: keyword.location,
        checkedAt,
        provider: sourceName,
        status: fetched.status,
        errorMessage: fetched.errorMessage,
        results: fetched.results,
        features: fetched.features,
        raw: fetched.raw
      });
      return file;
    } catch {
      // A snapshot failure must not lose the check itself.
      return null;
    }
  }

  /** Fetch and store one keyword. */
  async checkKeyword(keyword: KeywordRecord, signal?: AbortSignal): Promise<CheckOutcome> {
    const client = this.clients.getClientOrThrow(keyword.clientId);

    const fetched = await serpProvider.fetch(
      {
        keyword: keyword.phrase,
        country: keyword.country,
        device: keyword.device,
        location: keyword.location,
        // Stop paginating once the client is located.
        stopWhenDomainFound: client.primaryDomain
      },
      signal
    );

    return this.persist(keyword, client.primaryDomain, client.clientPath, fetched);
  }

  startRun(clientId: string): string {
    const runId = randomUUID();
    db.insert(syncRunsTable)
      .values({
        id: runId,
        clientId,
        kind: "serp-batch",
        status: "running",
        startedAt: nowIso(),
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

  /**
   * Close out a batch.
   *
   * A run where some checks were blocked is `partial`, not `completed` — the
   * distinction is what makes a slowly-degrading scraper visible instead of
   * looking like ordinary success.
   */
  finishRun(
    runId: string,
    counts: { ok: number; blocked: number; failed: number },
    errorMessage: string | null = null
  ): void {
    const status = counts.failed > 0 || counts.blocked > 0 ? "partial" : "completed";

    db.update(syncRunsTable)
      .set({
        status: counts.ok === 0 && (counts.blocked > 0 || counts.failed > 0) ? "failed" : status,
        completedAt: nowIso(),
        rowsWritten: counts.ok,
        itemsOk: counts.ok,
        itemsBlocked: counts.blocked,
        itemsFailed: counts.failed,
        errorMessage
      })
      .where(eq(syncRunsTable.id, runId))
      .run();
  }

  /** Checks performed today across all clients, for the daily cap. */
  checksToday(): number {
    const row = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(rankChecksTable)
      .where(eq(rankChecksTable.checkedDate, todayInGscZone()))
      .get();

    return Number(row?.count ?? 0);
  }

  remainingToday(): number {
    return Math.max(0, rankConfig.serpMaxChecksPerDay - this.checksToday());
  }
}
