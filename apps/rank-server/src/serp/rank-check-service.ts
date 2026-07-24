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
import { AlertRepository } from "../alerts/repository";
import { evaluateTransition, toReading, type Reading as AlertReading } from "../alerts/rules";
import { resolveConsensus, type Reading } from "./consensus";
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
  constructor(
    private readonly clients = new ClientRepository(),
    private readonly alerts = new AlertRepository()
  ) {}

  /**
   * The last real reading (ok or not-found) from a day *before* today.
   *
   * Alerts compare today's reading against this baseline, so a same-day re-run
   * compares against the same prior-day observation and de-dupes cleanly rather
   * than comparing against itself. Blocked/errored checks are excluded - an
   * alert must be anchored to a real prior observation, never to an unknown.
   */
  private previousReadingBeforeToday(keywordId: string): AlertReading | null {
    const row = db
      .select({ status: rankChecksTable.status, position: rankChecksTable.position })
      .from(rankChecksTable)
      .where(
        and(
          eq(rankChecksTable.keywordId, keywordId),
          sql`${rankChecksTable.status} IN ('ok','not-found')`,
          sql`${rankChecksTable.checkedDate} < ${todayInGscZone()}`
        )
      )
      .orderBy(desc(rankChecksTable.checkedAt))
      .limit(1)
      .get();

    return row ? toReading(row.status, row.position) : null;
  }

  /**
   * Raise alerts for a completed check.
   *
   * Deliberately best-effort and last: alerting must never fail or slow a rank
   * check. If the current reading is unknown, or there is no prior baseline,
   * nothing is raised - the same never-alert-on-unknown rule the engine enforces.
   */
  private evaluateAlerts(keyword: KeywordRecord, outcome: CheckOutcome): void {
    if (!rankConfig.alertsEnabled) {
      return;
    }
    try {
      const current = toReading(outcome.status, outcome.position);
      if (current.kind === "unknown") {
        return;
      }
      const previous = this.previousReadingBeforeToday(keyword.id);
      if (!previous) {
        return;
      }
      const proposals = evaluateTransition(previous, current, { largeMove: rankConfig.alertLargeMove });
      if (proposals.length > 0) {
        this.alerts.recordForKeyword(keyword.clientId, keyword.id, proposals);
      }
    } catch {
      // An alerting failure must not affect the stored check.
    }
  }

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
    /** The attempt whose full SERP (top-N, features, raw) is stored. */
    representative: SerpFetchResult,
    /**
     * The reconciled outcome. For a single check this is just that check's
     * resolution; for a consensus check it is the agreed answer across attempts.
     * Passing it in keeps persist() ignorant of how the outcome was decided.
     */
    resolved: {
      status: RankCheckStatus;
      position: number | null;
      rankingUrl: string | null;
      source: string;
      errorMessage: string | null;
    }
  ): Promise<CheckOutcome> {
    const sourceName = resolved.source;
    const checkedAt = nowIso();
    const checkedDate = todayInGscZone();
    const previousPosition = this.lastKnownPosition(keyword.id);

    const status = resolved.status;
    const match = resolved.position !== null ? { position: resolved.position, url: resolved.rankingUrl } : null;

    const rawPath = await this.writeSnapshot(clientPath, keyword, checkedAt, representative, sourceName);

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
          errorMessage: resolved.errorMessage
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
            errorMessage: resolved.errorMessage
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
      const top = representative.results.slice(0, STORED_RESULT_COUNT);
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

      if (representative.features.length > 0) {
        tx.insert(serpFeaturesTable)
          .values(
            representative.features.map((feature) => ({
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
      errorMessage: resolved.errorMessage
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

  /** One fetch, resolved into a single reading against the client domain. */
  private async fetchOne(
    keyword: KeywordRecord,
    clientDomain: string,
    signal?: AbortSignal
  ): Promise<{ fetched: SerpFetchResult; reading: Reading }> {
    const fetched = await serpProvider.fetch(
      {
        keyword: keyword.phrase,
        country: keyword.country,
        device: keyword.device,
        location: keyword.location,
        // Stop paginating once the client is located.
        stopWhenDomainFound: clientDomain
      },
      signal
    );

    const source = (fetched as ChainResult).usedProvider ?? serpProvider.name;
    const match = fetched.status === "ok" ? findClientPosition(fetched.results, clientDomain) : null;
    // "ok" from the provider means the page was read; whether the client is in
    // it decides ok vs not-found.
    const readingStatus = fetched.status === "ok" ? (match ? "ok" : "not-found") : fetched.status;

    return {
      fetched,
      reading: { status: readingStatus, position: match ? match.position : null, source }
    };
  }

  /**
   * Fetch and store one keyword.
   *
   * When SERP_CONSENSUS_RUNS > 1 the keyword is fetched several times and the
   * majority answer is stored, so proxy-rotation noise (measured live as a
   * 10/6/10 wobble on the same keyword) is smoothed away. On genuine
   * disagreement the outcome is `blocked` - unknown, never a guessed position.
   *
   * A single run (the default) behaves exactly as before: one fetch, one
   * reading, stored directly.
   */
  async checkKeyword(
    keyword: KeywordRecord,
    signal?: AbortSignal,
    runsOverride?: number
  ): Promise<CheckOutcome> {
    const client = this.clients.getClientOrThrow(keyword.clientId);
    const runs = Math.max(1, runsOverride ?? rankConfig.serpConsensusRuns);

    const attempts: Array<{ fetched: SerpFetchResult; reading: Reading }> = [];

    for (let attempt = 0; attempt < runs; attempt += 1) {
      if (signal?.aborted) {
        break;
      }
      attempts.push(await this.fetchOne(keyword, client.primaryDomain, signal));

      // A short gap between consensus attempts so they are more likely to
      // sample different proxies - back-to-back requests can hit the same one
      // and defeat the point.
      if (attempt < runs - 1 && !signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, rankConfig.serpConsensusDelayMs));
      }
    }

    const consensus = resolveConsensus(attempts.map((a) => a.reading));

    // Store the SERP from the attempt nearest the agreed position, so the saved
    // top-10 matches the reading we kept.
    const representative =
      attempts.find(
        (a) => a.reading.status === consensus.status && a.reading.position === consensus.position
      )?.fetched ??
      attempts.find((a) => a.reading.status === "ok")?.fetched ??
      attempts[attempts.length - 1]?.fetched;

    if (!representative) {
      // Cancelled before any attempt ran.
      return {
        keywordId: keyword.id,
        phrase: keyword.phrase,
        status: "error",
        position: null,
        previousPosition: this.lastKnownPosition(keyword.id),
        rankingUrl: null,
        errorMessage: "Cancelled before any check ran."
      };
    }

    // The ranking URL comes from the representative attempt at the agreed
    // position, so it matches the stored top-10.
    const rankingUrl =
      consensus.status === "ok" && representative.status === "ok"
        ? findClientPosition(representative.results, client.primaryDomain)?.url ?? null
        : null;

    // When consensus was applied, note the agreement so a low-confidence
    // reading is inspectable rather than silent.
    const consensusNote =
      runs > 1
        ? `Consensus of ${consensus.agreement.attempts}: ${consensus.agreement.okCount} ok, ` +
          `${consensus.agreement.notFoundCount} not-found, ${consensus.agreement.unknownCount} unknown` +
          (consensus.agreement.spread > 0 ? ` (spread ${consensus.agreement.spread})` : "")
        : null;

    const outcome = await this.persist(keyword, client.primaryDomain, client.clientPath, representative, {
      status: consensus.status,
      position: consensus.position,
      rankingUrl,
      source: consensus.source ?? (representative as ChainResult).usedProvider ?? serpProvider.name,
      errorMessage:
        consensus.status === "ok" || consensus.status === "not-found"
          ? consensusNote
          : representative.errorMessage ?? consensusNote
    });

    // Raise alerts last and best-effort, so nothing here can affect the check.
    this.evaluateAlerts(keyword, outcome);
    return outcome;
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
