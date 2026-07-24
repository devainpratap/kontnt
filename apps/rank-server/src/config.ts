import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const booleanish = (defaultValue: boolean) =>
  z.preprocess(
    (value) =>
      value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : value,
    z.boolean().default(defaultValue)
  );

const configSchema = z.object({
  RANK_HOST: z.string().default("127.0.0.1"),
  RANK_PORT: z.coerce.number().int().positive().default(3102),
  WORKFLOW_ROOT: z.string().optional(),
  RANK_DB_PATH: z.string().optional(),
  CLIENTS_ROOT: z.string().optional(),

  // Google OAuth. Credentials come from a Google Cloud project with the Search
  // Console API enabled. The OAuth app must be set to "In production" — apps
  // left in "Testing" are issued refresh tokens that expire after 7 days.
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:3102/api/google/callback"),
  // Hex/base64 key used to encrypt the refresh token at rest. Generated on
  // first run if absent and written to data/ with restrictive permissions.
  GOOGLE_TOKEN_KEY: z.string().default(""),

  // "chain" walks SERP_PROVIDER_CHAIN with failover; the single-provider values
  // force one source, which is how the local browser stays available for
  // ad-hoc use without being the default.
  SERP_PROVIDER: z
    .enum(["chain", "local", "scrapingrobot", "serpapi", "dataforseo", "serper"])
    .default("chain"),
  SERP_PROVIDER_CHAIN: z.string().default("serpapi,scrapingrobot,dataforseo"),
  // Headless Chrome is blocked by Google on the first request — measured, not
  // assumed. Headed works reliably, at the cost of a visible browser window.
  SERP_HEADLESS: booleanish(false),
  // Google ignores num=100 (deprecated in 2025) and serves 10 results a page,
  // so depth costs extra requests. 3 pages = top 30, which covers the range
  // where tracking is actually meaningful.
  SERP_MAX_PAGES: z.coerce.number().int().min(1).max(10).default(3),
  SERP_MAX_CHECKS_PER_DAY: z.coerce.number().int().positive().default(150),
  SERP_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(25_000),
  SERP_MAX_DELAY_MS: z.coerce.number().int().nonnegative().default(70_000),
  DATAFORSEO_LOGIN: z.string().default(""),
  DATAFORSEO_PASSWORD: z.string().default(""),
  SERPER_API_KEY: z.string().default(""),
  SCRAPINGROBOT_API_KEY: z.string().default(""),
  // Their API reference is not public; the generic HTML module is the
  // documented one and is what the driver uses. Overridable in case their
  // module naming differs on your account.
  SCRAPINGROBOT_MODULE: z.string().default("HtmlRequestScraper"),
  SERPAPI_API_KEY: z.string().default(""),

  // Monthly free allowances, used by the failover chain to move on before
  // spending a request to discover a provider is out of credit. 0 means the
  // provider has no free tier and is billed per request.
  SCRAPINGROBOT_MONTHLY_FREE: z.coerce.number().int().nonnegative().default(5000),
  SERPAPI_MONTHLY_FREE: z.coerce.number().int().nonnegative().default(250),
  SERPER_MONTHLY_FREE: z.coerce.number().int().nonnegative().default(0),
  DATAFORSEO_MONTHLY_FREE: z.coerce.number().int().nonnegative().default(0),

  // API providers need no anti-block pacing; the long delay exists only for the
  // browser driver, which Google actively challenges.
  SERP_API_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  // How many API checks to run at once. The one-at-a-time throttle exists only
  // to keep the local browser from being blocked; API providers have no such
  // limit, so a pool cuts a 42-keyword batch from minutes to well under one.
  // Forced to 1 for the local browser regardless of this value.
  SERP_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(5),

  // How many times to re-check each keyword and reconcile by majority. 1 = off
  // (one request per check). Set to 3 to smooth proxy-rotation noise, at 3x the
  // credit cost. On disagreement the result is stored as unknown, never guessed.
  SERP_CONSENSUS_RUNS: z.coerce.number().int().min(1).max(9).default(1),
  SERP_CONSENSUS_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),

  // Alerts on rank movement. Evaluated after each check against the last real
  // reading from a prior day; never raised on a blocked/unknown check.
  ALERTS_ENABLED: booleanish(true),
  ALERT_LARGE_MOVE: z.coerce.number().int().positive().default(5),

  // Scheduler (node-cron). Runs only while the server is up. Times are
  // Asia/Kolkata. Set a cron to empty to disable that task.
  SCHEDULER_ENABLED: booleanish(true),
  SCHEDULER_GSC_CRON: z.string().default("0 6 * * *"),      // 6am daily
  SCHEDULER_SERP_CRON: z.string().default("0 3 * * *"),     // 3am daily (due keywords only)
  SCHEDULER_REPORT_CRON: z.string().default("0 8 * * 1"),   // 8am Monday

  RANK_INSIGHT_MODEL: z.string().default("claude-opus-4-8"),
  CLAUDE_CLI_BIN: z.string().default("claude"),
  RANK_INSIGHT_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  RANK_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(5_000_000),

  GSC_BACKFILL_MONTHS: z.coerce.number().int().positive().max(16).default(16),
  GSC_ROLLING_WINDOW_DAYS: z.coerce.number().int().positive().default(5),
  GSC_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  RANK_CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:5274,http://127.0.0.1:5274"),
  RANK_SERVE_WEB: booleanish(false)
});

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultWorkspaceRoot = resolve(serverRoot, "../..");
const env = configSchema.parse(process.env);
// Resolve WORKFLOW_ROOT against the repo root rather than the process cwd.
// npm workspace scripts run with cwd = apps/rank-server, so a relative value
// like "." would otherwise point inside the app folder and put data/ and
// clients/ in the wrong place.
const workspaceRoot = resolve(defaultWorkspaceRoot, env.WORKFLOW_ROOT ?? ".");

if (env.SERP_MIN_DELAY_MS > env.SERP_MAX_DELAY_MS) {
  throw new Error("SERP_MIN_DELAY_MS must be less than or equal to SERP_MAX_DELAY_MS.");
}

export const rankConfig = {
  host: env.RANK_HOST,
  port: env.RANK_PORT,
  workspaceRoot,
  dataRoot: resolve(workspaceRoot, "data"),
  // Relative overrides resolve against the workspace root, not the process cwd,
  // for the same reason as WORKFLOW_ROOT above. An absolute value is respected
  // as given, since resolve() ignores the base when the target is absolute.
  clientsRoot: resolve(workspaceRoot, env.CLIENTS_ROOT ?? "clients"),
  dbPath: resolve(workspaceRoot, env.RANK_DB_PATH ?? "data/rank.sqlite"),

  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: env.GOOGLE_REDIRECT_URI,
  googleTokenKey: env.GOOGLE_TOKEN_KEY,

  serpProvider: env.SERP_PROVIDER,
  serpProviderChain: env.SERP_PROVIDER_CHAIN.split(",").map((n) => n.trim()).filter(Boolean),
  serpApiDelayMs: env.SERP_API_DELAY_MS,
  serpConcurrency: env.SERP_CONCURRENCY,
  serpConsensusRuns: env.SERP_CONSENSUS_RUNS,
  serpConsensusDelayMs: env.SERP_CONSENSUS_DELAY_MS,
  alertsEnabled: env.ALERTS_ENABLED,
  alertLargeMove: env.ALERT_LARGE_MOVE,
  schedulerEnabled: env.SCHEDULER_ENABLED,
  schedulerGscCron: env.SCHEDULER_GSC_CRON,
  schedulerSerpCron: env.SCHEDULER_SERP_CRON,
  schedulerReportCron: env.SCHEDULER_REPORT_CRON,
  serpHeadless: env.SERP_HEADLESS,
  serpMaxPages: env.SERP_MAX_PAGES,
  serpMaxChecksPerDay: env.SERP_MAX_CHECKS_PER_DAY,
  serpMinDelayMs: env.SERP_MIN_DELAY_MS,
  serpMaxDelayMs: env.SERP_MAX_DELAY_MS,
  dataForSeoLogin: env.DATAFORSEO_LOGIN,
  dataForSeoPassword: env.DATAFORSEO_PASSWORD,
  serperApiKey: env.SERPER_API_KEY,
  scrapingRobotApiKey: env.SCRAPINGROBOT_API_KEY,
  scrapingRobotModule: env.SCRAPINGROBOT_MODULE,
  serpApiKey: env.SERPAPI_API_KEY,
  monthlyFree: {
    scrapingrobot: env.SCRAPINGROBOT_MONTHLY_FREE,
    serpapi: env.SERPAPI_MONTHLY_FREE,
    serper: env.SERPER_MONTHLY_FREE,
    dataforseo: env.DATAFORSEO_MONTHLY_FREE,
    local: 0
  } as Record<string, number>,

  insightModel: env.RANK_INSIGHT_MODEL,
  claudeCliBin: env.CLAUDE_CLI_BIN,
  insightTimeoutMs: env.RANK_INSIGHT_TIMEOUT_MS,
  maxOutputBytes: env.RANK_MAX_OUTPUT_BYTES,

  gscBackfillMonths: env.GSC_BACKFILL_MONTHS,
  gscRollingWindowDays: env.GSC_ROLLING_WINDOW_DAYS,
  gscRetentionDays: env.GSC_RETENTION_DAYS,

  corsAllowedOrigins: env.RANK_CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  serveWeb: env.RANK_SERVE_WEB,
  webDistPath: resolve(serverRoot, "../rank-web/dist")
};

export async function ensureRankDirs() {
  await Promise.all([
    mkdir(rankConfig.dataRoot, { recursive: true }),
    mkdir(rankConfig.clientsRoot, { recursive: true })
  ]);
}
