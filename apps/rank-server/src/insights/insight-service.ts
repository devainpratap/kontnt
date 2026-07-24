import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { desc, eq } from "drizzle-orm";

import type { InsightKind, InsightRecord } from "@rankos/shared";

import { buildClientPaths, readTextFile, writeMarkdownFile } from "../clients/files";
import { ClientRepository } from "../clients/repository";
import { db } from "../db/client";
import { insightsTable } from "../db/schema";
import { addDays, latestLikelyDataDate } from "../gsc/date-utils";
import { getCoverage, getTotals } from "../gsc/queries";
import { ApiError } from "../lib/api-error";
import { generateBriefMarkdown, generateInsightMarkdown } from "./claude-runner";
import { buildBriefPrompt, buildInsightPrompt, renderStatsSection } from "./prompt-builder";
import { getPagePeriod, getQueryPageRows, getQueryPeriod } from "./queries";
import { buildInsightStats, type InsightStats } from "./stats";

/**
 * Generating a client report.
 *
 * The sequence is deliberate: compute everything first, write the prompt and
 * the statistics to disk, and only then call the model. If Claude is
 * unavailable the analysis is not lost — the prompt is sitting in the client
 * folder ready to paste into claude.ai, which is the same manual-handoff
 * fallback ContentOS uses.
 */

function nowIso() {
  return new Date().toISOString();
}

export type GeneratedInsight = {
  record: InsightRecord;
  markdown: string;
  brief: string | null;
};

type InsightRow = typeof insightsTable.$inferSelect;

function toRecord(row: InsightRow): InsightRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    kind: row.kind,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    promptPath: row.promptPath,
    outputPath: row.outputPath,
    briefPath: row.briefPath,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    completedAt: row.completedAt
  };
}

export class InsightService {
  constructor(private readonly clients = new ClientRepository()) {}

  listInsights(clientId: string): InsightRecord[] {
    return db
      .select()
      .from(insightsTable)
      .where(eq(insightsTable.clientId, clientId))
      .orderBy(desc(insightsTable.createdAt))
      .all()
      .map(toRecord);
  }

  getInsightOrThrow(insightId: string): InsightRecord {
    const row = db.select().from(insightsTable).where(eq(insightsTable.id, insightId)).get();
    if (!row) {
      throw new ApiError(`Insight not found: ${insightId}`, 404, "INSIGHT_NOT_FOUND");
    }
    return toRecord(row);
  }

  async readInsightMarkdown(insightId: string): Promise<string | null> {
    const record = this.getInsightOrThrow(insightId);
    return record.outputPath ? readTextFile(record.outputPath) : null;
  }

  async readInsightBrief(insightId: string): Promise<string | null> {
    const record = this.getInsightOrThrow(insightId);
    return record.briefPath ? readTextFile(record.briefPath) : null;
  }

  /** Compute the statistics for a window without calling the model. */
  computeStats(clientId: string, days: number, endDateOverride?: string): InsightStats {
    const client = this.clients.getClientOrThrow(clientId);
    const endDate = endDateOverride ?? latestLikelyDataDate();
    const startDate = addDays(endDate, -(days - 1));
    const previousEnd = addDays(startDate, -1);
    const previousStart = addDays(previousEnd, -(days - 1));

    void client;

    return buildInsightStats({
      window: { startDate, endDate, days },
      previousWindow: { startDate: previousStart, endDate: previousEnd },
      currentQueries: getQueryPeriod(clientId, startDate, endDate),
      previousQueries: getQueryPeriod(clientId, previousStart, previousEnd),
      currentPages: getPagePeriod(clientId, startDate, endDate),
      previousPages: getPagePeriod(clientId, previousStart, previousEnd),
      queryPageRows: getQueryPageRows(clientId, startDate, endDate),
      totals: getTotals(clientId, startDate, endDate),
      previousTotals: getTotals(clientId, previousStart, previousEnd),
      coverage: getCoverage(clientId, startDate, endDate)
    });
  }

  /**
   * Produce a report end to end.
   *
   * Refuses up front when there is no data for the window, rather than asking
   * the model to narrate an empty table — which produces a fluent report about
   * nothing, the most misleading possible output.
   */
  async generate(
    clientId: string,
    options: { days?: number; kind?: InsightKind; signal?: AbortSignal } = {}
  ): Promise<GeneratedInsight> {
    const client = this.clients.getClientOrThrow(clientId);
    const days = options.days ?? 28;
    const kind: InsightKind = options.kind ?? "weekly-report";

    const stats = this.computeStats(clientId, days);

    if (stats.totals.clicks === 0 && stats.totals.impressions === 0) {
      throw new ApiError(
        `No Search Console data for ${client.name} between ${stats.window.startDate} and ${stats.window.endDate}. Run a sync first.`,
        400,
        "INSIGHT_NO_DATA"
      );
    }

    const paths = buildClientPaths(client.clientPath);
    await mkdir(paths.insightsDir, { recursive: true });
    await mkdir(paths.promptsDir, { recursive: true });

    const id = randomUUID();
    const slug = `${stats.window.startDate}_to_${stats.window.endDate}`;
    const promptPath = join(paths.promptsDir, `${slug}-insight.md`);
    const briefPromptPath = join(paths.promptsDir, `${slug}-brief.md`);
    const outputPath = join(paths.insightsDir, `${slug}-report.md`);
    const briefPath = join(paths.insightsDir, `${slug}-brief.md`);
    const statsPath = join(paths.insightsDir, `${slug}-stats.md`);

    // Both prompts derive from the same computed stats, so the detailed report
    // and the WhatsApp brief can never disagree on a number.
    const prompt = buildInsightPrompt(client, stats);
    const briefPrompt = buildBriefPrompt(client, stats);

    db.insert(insightsTable)
      .values({
        id,
        clientId,
        kind,
        status: "running",
        periodStart: stats.window.startDate,
        periodEnd: stats.window.endDate,
        promptPath,
        outputPath: null,
        briefPath: null,
        errorMessage: null,
        createdAt: nowIso(),
        completedAt: null
      })
      .run();

    // Written before the model runs: if Claude is unavailable, the analysis
    // survives and the prompts can be pasted into claude.ai by hand.
    await writeMarkdownFile(promptPath, prompt);
    await writeMarkdownFile(briefPromptPath, briefPrompt);
    // The statistics kept separately, so every claim in either form can be
    // checked against the numbers it was derived from.
    await writeMarkdownFile(statsPath, renderStatsSection(stats));

    try {
      // The detailed report is the anchor artifact and is generated first.
      const markdown = await generateInsightMarkdown(prompt, options.signal);
      await writeMarkdownFile(outputPath, markdown);

      // The brief is best-effort: a transient failure on this second call must
      // not discard a good detailed report. On failure the report is still
      // completed, the brief is left unwritten, and the note explains why.
      let brief: string | null = null;
      let briefNote: string | null = null;
      try {
        brief = await generateBriefMarkdown(briefPrompt, options.signal);
        await writeMarkdownFile(briefPath, brief);
      } catch (briefError) {
        briefNote = `Detailed report ready; team brief could not be generated: ${
          briefError instanceof Error ? briefError.message : "unknown error"
        }`;
      }

      db.update(insightsTable)
        .set({
          status: "completed",
          outputPath,
          briefPath: brief ? briefPath : null,
          completedAt: nowIso(),
          errorMessage: briefNote
        })
        .where(eq(insightsTable.id, id))
        .run();

      return { record: this.getInsightOrThrow(id), markdown, brief };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Insight generation failed.";

      // "manual-input-required" rather than "failed": the prompt is on disk and
      // the run is completable by hand, which is a materially different state
      // from a broken one.
      const status = message.toLowerCase().includes("temporarily unavailable")
        ? "manual-input-required"
        : "failed";

      db.update(insightsTable)
        .set({ status, errorMessage: message, completedAt: nowIso() })
        .where(eq(insightsTable.id, id))
        .run();

      throw error;
    }
  }
}
