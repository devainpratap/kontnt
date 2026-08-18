import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type {
  AlertKind,
  CheckCadence,
  Device,
  GscPropertyType,
  InsightKind,
  InsightStatus,
  RankCheckSource,
  RankCheckStatus,
  SchedulerRunStatus,
  SchedulerTrigger,
  SyncRunKind,
  SyncRunStatus
} from "@rankos/shared";

/**
 * Single source of truth for the RankOS database. To change it: edit this file,
 * run `npx drizzle-kit generate --config drizzle.rank.config.ts`, and commit the
 * generated migration. Never hand-write DDL in db/client.ts.
 *
 * SQLite here is an *index*, not the record. Everything in `clients/<slug>/` on
 * disk is the source of truth and this database can be deleted and rebuilt.
 *
 * All date columns are `YYYY-MM-DD` strings in GSC's timezone (Pacific), never
 * Date objects — mixing local time in produces off-by-one duplicate day rows.
 */

export const clientsTable = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    primaryDomain: text("primary_domain").notNull(),
    gscProperty: text("gsc_property"),
    gscPropertyType: text("gsc_property_type").$type<GscPropertyType>(),
    // The client's primary market as a SerpApi/DataForSeo canonical location
    // (e.g. "Noida,Uttar Pradesh,India"). Google localizes by city, so this is
    // the default vantage every keyword without its own place is checked from -
    // the difference between a real local rank and a misleading national one.
    marketLocation: text("market_location"),
    // JSON array of branded queries excluded from opportunity analysis.
    brandTerms: text("brand_terms").notNull().default("[]"),
    notes: text("notes").notNull().default(""),
    clientPath: text("client_path").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    // Clients are archived, never hard-deleted, so history survives.
    archivedAt: text("archived_at")
  },
  (table) => ({
    slugUnique: uniqueIndex("clients_slug_unique").on(table.slug)
  })
);

export const keywordsTable = sqliteTable(
  "keywords",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    phrase: text("phrase").notNull(),
    country: text("country").notNull().default("in"),
    device: text("device").$type<Device>().notNull().default("desktop"),
    location: text("location"),
    // The page we *want* ranking. When a different URL ranks instead, that
    // mismatch is the cannibalization signal surfaced in the keyword table.
    targetUrl: text("target_url"),
    tags: text("tags").notNull().default("[]"),
    cadence: text("cadence").$type<CheckCadence>().notNull().default("weekly"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    clientIdIdx: index("keywords_client_id_idx").on(table.clientId),
    // One row per keyword per market. Re-importing the same list must not
    // silently duplicate rows and double the scrape volume.
    identityUnique: uniqueIndex("keywords_identity_unique").on(
      table.clientId,
      table.phrase,
      table.country,
      table.device,
      table.location
    )
  })
);

export const rankChecksTable = sqliteTable(
  "rank_checks",
  {
    id: text("id").primaryKey(),
    keywordId: text("keyword_id").notNull(),
    checkedAt: text("checked_at").notNull(),
    checkedDate: text("checked_date").notNull(),
    source: text("source").$type<RankCheckSource>().notNull(),
    /**
     * The most important column in this schema. "not-found" means the client
     * genuinely does not rank in the fetched window; "blocked"/"error" mean we
     * do not know. Collapsing these into a null position would report a
     * scraper failure to a client as a ranking collapse.
     */
    status: text("status").$type<RankCheckStatus>().notNull(),
    // Null unless status is "ok". Never chart a null as 0 or 100.
    position: real("position"),
    rankingUrl: text("ranking_url"),
    previousPosition: real("previous_position"),
    rawPath: text("raw_path"),
    errorMessage: text("error_message")
  },
  (table) => ({
    keywordCheckedIdx: index("rank_checks_keyword_checked_idx").on(table.keywordId, table.checkedDate),
    // One check per keyword per day per source keeps re-runs idempotent.
    keywordDaySourceUnique: uniqueIndex("rank_checks_keyword_day_source_unique").on(
      table.keywordId,
      table.checkedDate,
      table.source
    )
  })
);

/** Full top-N of every SERP check. Powers competitor tracking at no extra fetch cost. */
export const serpResultsTable = sqliteTable(
  "serp_results",
  {
    id: text("id").primaryKey(),
    rankCheckId: text("rank_check_id").notNull(),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    isClient: integer("is_client", { mode: "boolean" }).notNull().default(false)
  },
  (table) => ({
    rankCheckIdx: index("serp_results_rank_check_idx").on(table.rankCheckId),
    domainIdx: index("serp_results_domain_idx").on(table.domain)
  })
);

export const serpFeaturesTable = sqliteTable(
  "serp_features",
  {
    id: text("id").primaryKey(),
    rankCheckId: text("rank_check_id").notNull(),
    feature: text("feature").notNull(),
    present: integer("present", { mode: "boolean" }).notNull().default(true)
  },
  (table) => ({
    rankCheckIdx: index("serp_features_rank_check_idx").on(table.rankCheckId),
    rankCheckFeatureUnique: uniqueIndex("serp_features_check_feature_unique").on(
      table.rankCheckId,
      table.feature
    )
  })
);

/**
 * Raw Search Console query x page rows. The unique key is what makes the
 * rolling-window re-pull idempotent: Google revises the most recent days, so
 * each sync upserts rather than appends.
 */
export const gscDailyTable = sqliteTable(
  "gsc_daily",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    date: text("date").notNull(),
    query: text("query").notNull(),
    page: text("page").notNull(),
    device: text("device").notNull().default("ALL"),
    country: text("country").notNull().default("ALL"),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: real("ctr").notNull().default(0),
    // Impression-weighted average position. NOT a live SERP rank — the two are
    // shown as separate columns and are never averaged together.
    position: real("position").notNull().default(0)
  },
  (table) => ({
    clientDateIdx: index("gsc_daily_client_date_idx").on(table.clientId, table.date),
    clientQueryIdx: index("gsc_daily_client_query_idx").on(table.clientId, table.query),
    rowUnique: uniqueIndex("gsc_daily_row_unique").on(
      table.clientId,
      table.date,
      table.query,
      table.page,
      table.device,
      table.country
    )
  })
);

/**
 * Unfiltered property totals per day. Google omits rare queries from the
 * query-dimension breakdown for privacy, so query rows never sum to the real
 * total. Storing both lets the UI show attribution coverage honestly instead
 * of quietly under-reporting.
 */
export const gscDailyTotalsTable = sqliteTable(
  "gsc_daily_totals",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    date: text("date").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctr: real("ctr").notNull().default(0),
    position: real("position").notNull().default(0)
  },
  (table) => ({
    clientDateUnique: uniqueIndex("gsc_daily_totals_client_date_unique").on(table.clientId, table.date)
  })
);

/** Pre-aggregated weekly rows. Charts read this rather than scanning gsc_daily. */
export const gscWeeklyRollupTable = sqliteTable(
  "gsc_weekly_rollup",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    weekStart: text("week_start").notNull(),
    query: text("query").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    avgPosition: real("avg_position").notNull().default(0)
  },
  (table) => ({
    clientWeekIdx: index("gsc_weekly_client_week_idx").on(table.clientId, table.weekStart),
    rowUnique: uniqueIndex("gsc_weekly_row_unique").on(table.clientId, table.weekStart, table.query)
  })
);

/** Every background run, so quota exhaustion and scraper blocking are visible. */
export const syncRunsTable = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id"),
    kind: text("kind").$type<SyncRunKind>().notNull(),
    status: text("status").$type<SyncRunStatus>().notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    rowsWritten: integer("rows_written").notNull().default(0),
    itemsOk: integer("items_ok").notNull().default(0),
    itemsBlocked: integer("items_blocked").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    errorMessage: text("error_message")
  },
  (table) => ({
    clientKindIdx: index("sync_runs_client_kind_idx").on(table.clientId, table.kind),
    statusIdx: index("sync_runs_status_idx").on(table.status)
  })
);

export const alertsTable = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    keywordId: text("keyword_id"),
    kind: text("kind").$type<AlertKind>().notNull(),
    detectedAt: text("detected_at").notNull(),
    delta: real("delta"),
    payload: text("payload").notNull().default("{}"),
    acknowledgedAt: text("acknowledged_at")
  },
  (table) => ({
    clientAckIdx: index("alerts_client_ack_idx").on(table.clientId, table.acknowledgedAt)
  })
);

/** Claude-generated reports. The Markdown lives on disk; this row indexes it. */
export const insightsTable = sqliteTable(
  "insights",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    kind: text("kind").$type<InsightKind>().notNull(),
    status: text("status").$type<InsightStatus>().notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    promptPath: text("prompt_path"),
    outputPath: text("output_path"),
    // A single report generation produces two artifacts from the same computed
    // stats: the detailed report (outputPath) and the short WhatsApp brief.
    // Both are files on disk; this indexes the second one.
    briefPath: text("brief_path"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at")
  },
  (table) => ({
    clientPeriodIdx: index("insights_client_period_idx").on(table.clientId, table.periodStart)
  })
);

/**
 * The single connected Google account. Refresh token is stored encrypted at
 * rest. `lastErrorAt`/`lastErrorMessage` back the loud "Reconnect Google"
 * banner — a dead token must never fail silently.
 */
export const googleAccountsTable = sqliteTable("google_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  scope: text("scope").notNull(),
  connectedAt: text("connected_at").notNull(),
  lastErrorAt: text("last_error_at"),
  lastErrorMessage: text("last_error_message")
});

/**
 * Monthly consumption per SERP provider.
 *
 * Free tiers are counted in requests, and a request consumes quota whether or
 * not it returns a usable result — so usage cannot be derived from rank_checks
 * (which only records outcomes). This ledger is incremented before each call so
 * the failover chain knows to move to the next provider instead of burning a
 * request to discover it is out of credit.
 *
 * `yearMonth` is a `YYYY-MM` string, matching the calendar month that free
 * allowances reset on.
 */
export const providerUsageTable = sqliteTable(
  "provider_usage",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    yearMonth: text("year_month").notNull(),
    used: integer("used").notNull().default(0),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    providerMonthUnique: uniqueIndex("provider_usage_provider_month_unique").on(
      table.provider,
      table.yearMonth
    )
  })
);

/**
 * One row per Operator run: the index over the on-disk journal.
 *
 * The journal Markdown on disk is the record; this table makes runs listable
 * and lets a run reference what it found and did without re-reading files. The
 * escalation payload is JSON so the in-app inbox can render each item.
 */
export const operatorRunsTable = sqliteTable(
  "operator_runs",
  {
    id: text("id").primaryKey(),
    ranAt: text("ran_at").notNull(),
    /** ok | warn | critical - the worst finding severity this run. */
    healthLevel: text("health_level").notNull(),
    findingsCount: integer("findings_count").notNull().default(0),
    actionsCount: integer("actions_count").notNull().default(0),
    escalationsCount: integer("escalations_count").notNull().default(0),
    /** Open escalations needing the operator, as JSON, until acknowledged. */
    escalations: text("escalations").notNull().default("[]"),
    acknowledgedAt: text("acknowledged_at"),
    summary: text("summary").notNull().default(""),
    journalPath: text("journal_path")
  },
  (table) => ({
    ranAtIdx: index("operator_runs_ran_at_idx").on(table.ranAt)
  })
);

/**
 * One row per scheduled-task run.
 *
 * The scheduler's `lastRuns` was in-memory only, so a restart erased all history
 * and RankOS could not tell whether a run had been missed. This table is the
 * durable record: it survives restarts (backing the Settings "last run"
 * display), and it lets missed-run recovery ask "did this task actually run
 * since its last scheduled fire?" - the check that turns a slept-through cron
 * into a caught-up one. `trigger` marks whether a run was the normal `cron`
 * fire or a `boot`/`heartbeat` recovery.
 */
export const schedulerRunsTable = sqliteTable(
  "scheduler_runs",
  {
    id: text("id").primaryKey(),
    taskName: text("task_name").notNull(),
    ranAt: text("ran_at").notNull(),
    trigger: text("trigger").$type<SchedulerTrigger>().notNull().default("cron"),
    status: text("status").$type<SchedulerRunStatus>().notNull().default("ok"),
    summary: text("summary").notNull().default("")
  },
  (table) => ({
    taskRanAtIdx: index("scheduler_runs_task_ran_at_idx").on(table.taskName, table.ranAt)
  })
);
