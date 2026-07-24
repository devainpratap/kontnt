import type { FastifyInstance, FastifyReply } from "fastify";

import {
  createClientSchema,
  createKeywordSchema,
  importKeywordsSchema,
  updateClientSchema,
  type KeywordSuggestionResponse,
  type RankAppSettings
} from "@rankos/shared";

import { ClientRepository } from "./clients/repository";
import { DEFAULT_OPPORTUNITY_OPTIONS, buildSuggestions } from "./keywords/opportunity";
import { KeywordRepository } from "./keywords/repository";
import { activeChain, serpProvider } from "./serp/provider";
import { runCheckBatch, selectDueKeywords } from "./serp/queue";
import {
  getCheckHealth,
  getKeywordsWithLastCheck,
  getLatestSerp,
  getPositionHistory,
  getShareOfSerp
} from "./serp/queries";
import { RankCheckService } from "./serp/rank-check-service";
import { getClaudeStatus } from "./insights/claude-runner";
import { InsightService } from "./insights/insight-service";
import { rankConfig } from "./config";
import { listSites } from "./gsc/api-client";
import { addDays, latestLikelyDataDate, todayInGscZone } from "./gsc/date-utils";
import {
  getCoverage,
  getDailyTotals,
  getDateBounds,
  getRecentRuns,
  getTopPages,
  getTopQueries,
  getTotals
} from "./gsc/queries";
import * as runLock from "./gsc/run-lock";
import { GscSyncService } from "./gsc/sync";
import {
  GoogleAccountRepository,
  consumeState,
  rememberState
} from "./google/account-repository";
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchAccountEmail,
  isGoogleConfigured
} from "./google/oauth";
import { createStateToken } from "./google/token-crypto";
import { ApiError } from "./lib/api-error";

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

/** Where to send the browser after the OAuth round trip completes. */
function webOrigin(): string {
  return rankConfig.corsAllowedOrigins[0] ?? "http://localhost:5274";
}

export async function registerRankRoutes(app: FastifyInstance) {
  const clients = new ClientRepository();
  const keywords = new KeywordRepository();
  const google = new GoogleAccountRepository();
  const sync = new GscSyncService(clients, google);
  const rankChecks = new RankCheckService(clients);
  const insights = new InsightService(clients);

  app.get("/api/health", async () => ({ ok: true, service: "rankos" }));

  app.get("/api/settings", async (): Promise<RankAppSettings> => ({
    google: google.getStatus(),
    serp: await serpProvider.getStatus(),
    clientsRoot: rankConfig.clientsRoot
  }));

  // ---------------------------------------------------------------- clients

  app.get("/api/clients", async (request) => {
    const includeArchived = (request.query as { includeArchived?: string })?.includeArchived === "true";
    return clients.listClients({ includeArchived });
  });

  app.post("/api/clients", async (request, reply) => {
    const parsed = createClientSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid client payload.");
    }
    return reply.code(201).send(await clients.createClient(parsed.data));
  });

  app.get("/api/clients/:clientId", async (request) => {
    const { clientId } = request.params as { clientId: string };
    return clients.getClientOrThrow(clientId);
  });

  app.patch("/api/clients/:clientId", async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    const parsed = updateClientSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid client payload.");
    }
    return clients.updateClient(clientId, parsed.data);
  });

  // ----------------------------------------------------------- google oauth

  app.get("/api/google/status", async () => google.getStatus());

  /**
   * Start the consent flow. Returns the URL rather than redirecting, so the
   * frontend can open it deliberately and the endpoint stays testable.
   */
  app.post("/api/google/connect", async (_request, reply) => {
    if (!isGoogleConfigured()) {
      return reply.code(400).send({
        error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then restart the server.",
        code: "GOOGLE_NOT_CONFIGURED"
      });
    }

    const state = createStateToken();
    rememberState(state);
    return { authUrl: buildAuthUrl(state) };
  });

  /**
   * OAuth callback. Google redirects the browser here, so this responds with a
   * redirect back into the app rather than JSON.
   */
  app.get("/api/google/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const back = (status: string, detail?: string) =>
      reply.redirect(
        `${webOrigin()}/settings?google=${status}${detail ? `&detail=${encodeURIComponent(detail)}` : ""}`
      );

    if (query.error) {
      return back("denied", query.error);
    }
    if (!query.code || !query.state) {
      return back("error", "Missing code or state.");
    }
    // Single-use, time-limited state: without this check a crafted callback URL
    // could bind an attacker's Google account to this install.
    if (!consumeState(query.state)) {
      return back("error", "Expired or unrecognised state. Start the connection again.");
    }

    try {
      const tokens = await exchangeCodeForTokens(query.code);
      const email = await fetchAccountEmail(tokens.accessToken);
      google.connect({
        email,
        refreshToken: tokens.refreshToken as string,
        scope: tokens.scope
      });
      return back("connected");
    } catch (error) {
      return back("error", error instanceof Error ? error.message : "Connection failed.");
    }
  });

  app.post("/api/google/disconnect", async () => {
    await google.disconnect();
    return { ok: true };
  });

  /** Every Search Console property the connected account can read. */
  app.get("/api/google/properties", async () => {
    const accessToken = await google.getAccessToken();
    return listSites({ accessToken });
  });

  // ------------------------------------------------------------ gsc syncing

  /**
   * Fire-and-poll: validate cheaply, take the lock, run detached, return 202.
   * A full backfill takes minutes, so the request must not hold the connection.
   */
  const startSync = async (
    reply: FastifyReply,
    clientId: string,
    kind: "gsc-sync" | "gsc-backfill"
  ) => {
    // Throws 404/400 before the 202, so a missing client or unlinked property
    // is an immediate error rather than a silently failed background run.
    const client = clients.getClientOrThrow(clientId);
    if (!client.gscProperty) {
      throw new ApiError(
        `Client "${client.name}" has no Search Console property linked.`,
        400,
        "CLIENT_NO_GSC_PROPERTY"
      );
    }
    if (!google.isConnected()) {
      throw new ApiError("Connect Google before syncing.", 400, "GOOGLE_NOT_CONNECTED");
    }

    const started = runLock.start(clientId, kind, (signal) =>
      kind === "gsc-backfill"
        ? sync.backfillClient(clientId, signal)
        : sync.syncClient({ clientId, signal })
    );

    if (!started) {
      return reply.code(409).send({ error: "A sync is already running for this client.", code: "SYNC_ALREADY_RUNNING" });
    }

    return reply.code(202).send({ status: "running", kind });
  };

  app.post("/api/clients/:clientId/gsc/sync", async (request, reply) =>
    startSync(reply, (request.params as { clientId: string }).clientId, "gsc-sync")
  );

  app.post("/api/clients/:clientId/gsc/backfill", async (request, reply) =>
    startSync(reply, (request.params as { clientId: string }).clientId, "gsc-backfill")
  );

  app.post("/api/clients/:clientId/gsc/cancel", async (request) => {
    const { clientId } = request.params as { clientId: string };
    const cancelled = runLock.cancel(clientId, "gsc-sync") || runLock.cancel(clientId, "gsc-backfill");
    return { cancelled };
  });

  /** Sync state for polling: what is in flight plus recent run history. */
  app.get("/api/clients/:clientId/gsc/status", async (request) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    return {
      running: runLock.hasAnyRunning(clientId),
      bounds: getDateBounds(clientId),
      runs: getRecentRuns(clientId, 5)
    };
  });

  /**
   * Everything the dashboard needs for one window, in one round trip:
   * KPIs, the previous-period comparison, the trend series, top queries and
   * pages, and the attribution-coverage figure.
   */
  app.get("/api/clients/:clientId/gsc/performance", async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    const query = request.query as { days?: string; startDate?: string; endDate?: string };
    const days = Number(query.days ?? 28);
    if (!Number.isInteger(days) || days < 1 || days > 500) {
      return badRequest(reply, "days must be an integer between 1 and 500.");
    }

    const endDate = query.endDate ?? latestLikelyDataDate();
    const startDate = query.startDate ?? addDays(endDate, -(days - 1));

    // Same-length immediately-preceding window, so deltas compare like with like.
    const previousEnd = addDays(startDate, -1);
    const previousStart = addDays(previousEnd, -(days - 1));

    return {
      window: { startDate, endDate, days },
      totals: getTotals(clientId, startDate, endDate),
      previousTotals: getTotals(clientId, previousStart, previousEnd),
      daily: getDailyTotals(clientId, startDate, endDate),
      topQueries: getTopQueries(clientId, startDate, endDate, 50),
      topPages: getTopPages(clientId, startDate, endDate, 50),
      coverage: getCoverage(clientId, startDate, endDate),
      bounds: getDateBounds(clientId)
    };
  });

  // --------------------------------------------------------------- keywords

  app.get("/api/clients/:clientId/keywords", async (request) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    // Match keywords against the last 28 days of Search Console data, so the
    // table can show GSC position beside a tracked rank without blending them.
    const endDate = latestLikelyDataDate();
    return keywords.listWithStatus(clientId, { startDate: addDays(endDate, -27), endDate });
  });

  app.post("/api/clients/:clientId/keywords", async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    const parsed = createKeywordSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid keyword payload.");
    }

    return reply.code(201).send(keywords.createKeyword(clientId, parsed.data));
  });

  app.post("/api/clients/:clientId/keywords/import", async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    const parsed = importKeywordsSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid import payload.");
    }

    const { raw, ...defaults } = parsed.data;
    return keywords.importKeywords(clientId, raw, defaults);
  });

  app.patch("/api/keywords/:keywordId", async (request) => {
    const { keywordId } = request.params as { keywordId: string };
    const body = request.body as {
      targetUrl?: string | null;
      tags?: string[];
      cadence?: "daily" | "weekly" | "paused";
      isActive?: boolean;
    };
    return keywords.updateKeyword(keywordId, body);
  });

  app.delete("/api/keywords/:keywordId", async (request, reply) => {
    const { keywordId } = request.params as { keywordId: string };
    keywords.deleteKeyword(keywordId);
    return reply.code(204).send();
  });

  /**
   * Which keywords are worth tracking, derived entirely from this client's own
   * Search Console history. No scraping involved — the data is already local.
   */
  app.get("/api/clients/:clientId/keywords/suggestions", async (request, reply): Promise<KeywordSuggestionResponse> => {
    const { clientId } = request.params as { clientId: string };
    const client = clients.getClientOrThrow(clientId);

    const query = request.query as {
      days?: string;
      minImpressions?: string;
      minPosition?: string;
      maxPosition?: string;
      limit?: string;
    };

    const days = Number(query.days ?? 90);
    if (!Number.isInteger(days) || days < 1 || days > 500) {
      throw new ApiError("days must be an integer between 1 and 500.", 400, "INVALID_WINDOW");
    }

    const endDate = latestLikelyDataDate();
    const startDate = addDays(endDate, -(days - 1));

    const candidates = keywords.suggestionCandidates(clientId, { startDate, endDate });

    const { suggestions, totals } = buildSuggestions(candidates, {
      ...DEFAULT_OPPORTUNITY_OPTIONS,
      minImpressions: Number(query.minImpressions ?? DEFAULT_OPPORTUNITY_OPTIONS.minImpressions),
      minPosition: Number(query.minPosition ?? DEFAULT_OPPORTUNITY_OPTIONS.minPosition),
      maxPosition: Number(query.maxPosition ?? DEFAULT_OPPORTUNITY_OPTIONS.maxPosition),
      limit: Number(query.limit ?? DEFAULT_OPPORTUNITY_OPTIONS.limit),
      brandTerms: client.brandTerms,
      trackedPhrases: keywords.trackedPhrases(clientId)
    });

    void reply;
    return { window: { startDate, endDate, days }, suggestions, totals };
  });

  // ------------------------------------------------------------ rank checks

  /**
   * Start a batch of live rank checks.
   *
   * Fire-and-poll like the GSC syncs, but far slower by design: checks are
   * serialised with a 25-70s gap, so 50 keywords takes roughly 40 minutes.
   * That pacing is what keeps the free local provider working at all.
   */
  app.post("/api/clients/:clientId/serp/check", async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    const body = (request.body ?? {}) as { keywordIds?: string[]; dueOnly?: boolean };

    const withLastCheck = getKeywordsWithLastCheck(clientId);

    let targets = body.keywordIds?.length
      ? withLastCheck.filter((keyword) => body.keywordIds?.includes(keyword.id))
      : body.dueOnly === false
        ? withLastCheck.filter((keyword) => keyword.isActive && keyword.cadence !== "paused")
        : selectDueKeywords(withLastCheck);

    // Never start a run that cannot do anything — an empty 202 looks like
    // success and leaves the operator waiting for results that never come.
    if (targets.length === 0) {
      return reply.code(400).send({
        error: "No keywords are due for a check right now.",
        code: "NO_KEYWORDS_DUE"
      });
    }

    const remaining = rankChecks.remainingToday();
    if (remaining <= 0) {
      return reply.code(429).send({
        error: `Daily cap of ${rankConfig.serpMaxChecksPerDay} checks already reached. Resets tomorrow.`,
        code: "SERP_DAILY_CAP"
      });
    }

    const status = await serpProvider.getStatus();
    if (!status.available) {
      return reply.code(400).send({ error: status.message, code: "SERP_PROVIDER_UNAVAILABLE" });
    }

    targets = targets.slice(0, remaining);

    const started = runLock.start(clientId, "serp-batch", async (signal) => {
      const runId = rankChecks.startRun(clientId);
      const progress = await runCheckBatch(targets, rankChecks, { signal });
      rankChecks.finishRun(
        runId,
        { ok: progress.ok, blocked: progress.blocked, failed: progress.failed },
        progress.stoppedReason
      );
      return progress;
    });

    if (!started) {
      return reply.code(409).send({
        error: "A rank check batch is already running for this client.",
        code: "SERP_ALREADY_RUNNING"
      });
    }

    return reply.code(202).send({
      status: "running",
      queued: targets.length,
      remainingToday: remaining,
      estimatedMinutes: Math.ceil(
        (targets.length * ((rankConfig.serpMinDelayMs + rankConfig.serpMaxDelayMs) / 2)) / 60_000
      )
    });
  });

  app.post("/api/clients/:clientId/serp/cancel", async (request) => {
    const { clientId } = request.params as { clientId: string };
    return { cancelled: runLock.cancel(clientId, "serp-batch") };
  });

  /** Batch state plus check health, so a degrading scraper is visible. */
  app.get("/api/clients/:clientId/serp/status", async (request) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    const since = addDays(todayInGscZone(), -7);

    return {
      running: runLock.isRunning(clientId, "serp-batch"),
      provider: serpProvider.name,
      remainingToday: rankChecks.remainingToday(),
      dailyCap: rankConfig.serpMaxChecksPerDay,
      // Per-provider free budget, so an exhausted tier is visible before it
      // silently becomes the reason checks stopped.
      budgets: activeChain?.budgets() ?? [],
      health: getCheckHealth(clientId, since),
      runs: getRecentRuns(clientId, 5).filter((run) => run.kind === "serp-batch")
    };
  });

  app.get("/api/keywords/:keywordId/history", async (request) => {
    const { keywordId } = request.params as { keywordId: string };
    keywords.getKeywordOrThrow(keywordId);

    return {
      history: getPositionHistory(keywordId),
      latestSerp: getLatestSerp(keywordId)
    };
  });

  // ---------------------------------------------------------------- insights

  app.get("/api/insights/status", async () => getClaudeStatus());

  app.get("/api/clients/:clientId/insights", async (request) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);
    return insights.listInsights(clientId);
  });

  /**
   * The computed statistics on their own, with no model involved.
   *
   * Powers the "show me the numbers behind this" view, and makes every claim in
   * a generated report checkable against its source.
   */
  app.get("/api/clients/:clientId/insights/stats", async (request) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);
    const days = Number((request.query as { days?: string }).days ?? 28);
    if (!Number.isInteger(days) || days < 7 || days > 365) {
      throw new ApiError("days must be an integer between 7 and 365.", 400, "INVALID_WINDOW");
    }
    return insights.computeStats(clientId, days);
  });

  /** Fire-and-poll: report generation takes a minute or two. */
  app.post("/api/clients/:clientId/insights", async (request, reply) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    const body = (request.body ?? {}) as { days?: number };
    const days = body.days ?? 28;

    const claude = await getClaudeStatus();
    if (!claude.available) {
      return reply.code(400).send({ error: claude.message, code: "CLAUDE_UNAVAILABLE" });
    }

    const started = runLock.start(clientId, "insight", (signal) =>
      insights.generate(clientId, { days, signal })
    );

    if (!started) {
      return reply.code(409).send({
        error: "A report is already being generated for this client.",
        code: "INSIGHT_ALREADY_RUNNING"
      });
    }

    return reply.code(202).send({ status: "running", days });
  });

  app.get("/api/insights/:insightId", async (request) => {
    const { insightId } = request.params as { insightId: string };
    return {
      record: insights.getInsightOrThrow(insightId),
      markdown: await insights.readInsightMarkdown(insightId),
      brief: await insights.readInsightBrief(insightId)
    };
  });

  /** Which domains own this client's tracked SERPs. Free — pages already fetched. */
  app.get("/api/clients/:clientId/serp/competitors", async (request) => {
    const { clientId } = request.params as { clientId: string };
    clients.getClientOrThrow(clientId);

    const days = Number((request.query as { days?: string }).days ?? 30);
    const since = addDays(todayInGscZone(), -Math.min(Math.max(days, 1), 365));

    return { since, domains: getShareOfSerp(clientId, since) };
  });
}
