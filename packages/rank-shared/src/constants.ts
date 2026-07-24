/**
 * String-literal enums shared by apps/rank-server and apps/rank-web.
 * These are the single source of truth for every status/kind value that
 * crosses the API boundary or is persisted to SQLite.
 */

/** Search Console property flavour. Domain properties are prefixed `sc-domain:`. */
export const gscPropertyTypes = ["domain", "url-prefix"] as const;

export const devices = ["desktop", "mobile"] as const;

/**
 * Outcome of a single SERP check. The distinction between `not-found` and
 * `blocked`/`error` is load-bearing: `not-found` means the client genuinely
 * does not rank in the fetched window, while `blocked`/`error` mean we do not
 * know. Never collapse these into a null position — see RANK_AGENTS.md.
 */
export const rankCheckStatuses = ["ok", "not-found", "blocked", "error"] as const;

/** Which engine produced a rank check, so mixed-source history stays auditable. */
export const rankCheckSources = [
  "local",
  "scrapingrobot",
  "serpapi",
  "dataforseo",
  "serper",
  "manual"
] as const;

/** SERP features we attempt to detect on a results page. */
export const serpFeatures = [
  "featured-snippet",
  "people-also-ask",
  "ai-overview",
  "local-pack",
  "image-pack",
  "video-pack",
  "shopping",
  "site-links"
] as const;

/** Kinds of background run recorded in `sync_runs`. */
export const syncRunKinds = ["gsc-sync", "gsc-backfill", "serp-batch", "rollup", "insight"] as const;

export const syncRunStatuses = ["running", "completed", "partial", "failed"] as const;

/** Alert rules evaluated after each SERP batch / GSC sync. */
export const alertKinds = [
  "dropped-out-of-top-10",
  "dropped-out-of-top-3",
  "entered-top-3",
  "large-move",
  "page-lost-clicks",
  "new-competitor-top-3"
] as const;

export const insightKinds = ["weekly-report", "monthly-report", "ad-hoc"] as const;

export const insightStatuses = ["pending", "running", "completed", "manual-input-required", "failed"] as const;

/** How often a keyword should be re-checked against the live SERP. */
export const checkCadences = ["daily", "weekly", "paused"] as const;

/**
 * Google Search Console reports dates in Pacific Time. Every date in this
 * system is a `YYYY-MM-DD` string interpreted in this zone; storing local
 * `Date` objects creates off-by-one duplicate rows that are painful to debug.
 */
export const GSC_TIMEZONE = "America/Los_Angeles";

/**
 * Google revises the most recent days of Search Console data after first
 * publishing them. Rows within this many days of the latest available date are
 * flagged provisional in the UI rather than charted as a cliff-edge drop.
 */
export const GSC_PROVISIONAL_DAYS = 3;
