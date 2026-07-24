import type { KeywordSuggestion, KeywordSuggestionReason } from "@rankos/shared";

/**
 * Turning Search Console history into a tracking shortlist.
 *
 * The hard question in rank tracking is not "how do I check a position" but
 * "which keywords are worth checking". Guessing fills the tracker with terms
 * nobody searches. The client's own impression data already answers it: a query
 * with real impressions sitting just off page one is where movement matters.
 *
 * Everything here is deterministic arithmetic over rows already in the
 * database. No scraping, no model, no network.
 */

/**
 * Organic CTR by position, used only to rank candidates against each other.
 *
 * These are rounded industry averages, not a promise about any specific site —
 * real CTR varies enormously with SERP features and intent. The output is
 * labelled "modelled" wherever it surfaces, and the ordering it produces is far
 * more meaningful than the absolute number.
 */
const CTR_BY_POSITION: Record<number, number> = {
  1: 0.27,
  2: 0.15,
  3: 0.11,
  4: 0.08,
  5: 0.06,
  6: 0.05,
  7: 0.04,
  8: 0.033,
  9: 0.028,
  10: 0.025
};

const TAIL_CTR = 0.008; // positions 11-20
const DEEP_CTR = 0.002; // positions 21+

export function estimateCtr(position: number): number {
  if (position < 1) {
    return CTR_BY_POSITION[1];
  }
  const rounded = Math.round(position);
  if (rounded <= 10) {
    return CTR_BY_POSITION[rounded] ?? TAIL_CTR;
  }
  return rounded <= 20 ? TAIL_CTR : DEEP_CTR;
}

/** The rank we model "winning" as. Position 3 is realistic; position 1 is not. */
const TARGET_POSITION = 3;

export type CandidateRow = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  /**
   * Pages ranking *meaningfully* for this query, not merely at all.
   *
   * Counting every distinct URL over a 90-day window flags almost everything:
   * a page that surfaced on three days with five impressions is noise, or a
   * URL migration, not two pages competing. See COMPETING_PAGE_SHARE.
   */
  pageCount: number;
  topPage: string;
};

/**
 * A second page counts as competing only if it earns at least this share of
 * the leading page's impressions. Tuned against real data where a single query
 * had one page on 3,168 impressions and two others on 9 and 5.
 */
export const COMPETING_PAGE_SHARE = 0.2;

/** Below this, a page is too small to be worth calling cannibalization. */
export const COMPETING_PAGE_MIN_IMPRESSIONS = 10;

/**
 * How many pages are genuinely competing for a query, given each page's
 * impressions in the window.
 */
export function countCompetingPages(pageImpressions: number[]): number {
  if (pageImpressions.length === 0) {
    return 0;
  }

  const leader = Math.max(...pageImpressions);
  const threshold = Math.max(COMPETING_PAGE_MIN_IMPRESSIONS, leader * COMPETING_PAGE_SHARE);

  return pageImpressions.filter((impressions) => impressions >= threshold).length;
}

export type OpportunityOptions = {
  /** Ignore noise: queries below this many impressions in the window. */
  minImpressions: number;
  /** Already on page one and winning — nothing to chase. */
  minPosition: number;
  /** Too far back for a realistic move. */
  maxPosition: number;
  brandTerms: string[];
  /** Phrases already tracked, so suggestions never repeat what you have. */
  trackedPhrases: string[];
  limit: number;
};

export const DEFAULT_OPPORTUNITY_OPTIONS: OpportunityOptions = {
  minImpressions: 30,
  minPosition: 4,
  maxPosition: 30,
  brandTerms: [],
  trackedPhrases: [],
  limit: 50
};

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A query is branded when it contains a brand term as a whole word.
 * Substring matching would wrongly exclude "smiracle cream" for brand "smira".
 */
export function isBrandQuery(query: string, brandTerms: string[]): boolean {
  const normalisedQuery = normalise(query);

  return brandTerms.some((term) => {
    const normalisedTerm = normalise(term);
    if (!normalisedTerm) {
      return false;
    }
    const escaped = normalisedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalisedQuery);
  });
}

/**
 * Modelled extra clicks per window if the query reached TARGET_POSITION.
 * Clamped at zero: a query already outperforming the curve is not an
 * opportunity, and a negative number would sort it above real ones.
 */
export function opportunityClicks(impressions: number, currentPosition: number, currentClicks: number): number {
  if (currentPosition <= TARGET_POSITION) {
    return 0;
  }
  const potential = impressions * estimateCtr(TARGET_POSITION);
  return Math.max(0, Math.round(potential - currentClicks));
}

function reasonsFor(row: CandidateRow, options: OpportunityOptions): KeywordSuggestionReason[] {
  const reasons: KeywordSuggestionReason[] = [];

  if (row.position >= options.minPosition && row.position <= options.maxPosition) {
    reasons.push("striking-distance");
  }

  // Two or more URLs ranking for one query means the site is competing with
  // itself and Google is picking; that is worth watching explicitly.
  if (row.pageCount >= 2) {
    reasons.push("cannibalization");
  }

  // Ranking well but under-earning: usually a title/meta or SERP-feature
  // problem rather than a ranking problem, and the fix is different.
  const expected = estimateCtr(row.position);
  const actual = row.impressions > 0 ? row.clicks / row.impressions : 0;
  if (row.impressions >= options.minImpressions * 3 && row.position <= 10 && actual < expected * 0.5) {
    reasons.push("high-impression-low-ctr");
  }

  return reasons;
}

/**
 * Rank candidate queries into a tracking shortlist.
 *
 * Returns the filtered suggestions plus the counts that were excluded, so the
 * UI can explain why a shortlist is short rather than just showing nothing.
 */
export function buildSuggestions(
  candidates: CandidateRow[],
  options: OpportunityOptions = DEFAULT_OPPORTUNITY_OPTIONS
): { suggestions: KeywordSuggestion[]; totals: { candidates: number; alreadyTracked: number; brandExcluded: number } } {
  const tracked = new Set(options.trackedPhrases.map(normalise));

  let alreadyTracked = 0;
  let brandExcluded = 0;

  const suggestions: KeywordSuggestion[] = [];

  for (const row of candidates) {
    if (row.impressions < options.minImpressions) {
      continue;
    }

    if (tracked.has(normalise(row.query))) {
      alreadyTracked += 1;
      continue;
    }

    if (isBrandQuery(row.query, options.brandTerms)) {
      // Brand queries rank because of the brand, so they tell you nothing about
      // SEO progress and would crowd out the terms that do.
      brandExcluded += 1;
      continue;
    }

    const reasons = reasonsFor(row, options);
    if (reasons.length === 0) {
      continue;
    }

    suggestions.push({
      query: row.query,
      clicks: row.clicks,
      impressions: row.impressions,
      position: row.position,
      pageCount: row.pageCount,
      topPage: row.topPage,
      opportunityClicks: opportunityClicks(row.impressions, row.position, row.clicks),
      reasons
    });
  }

  suggestions.sort(
    (a, b) =>
      b.opportunityClicks - a.opportunityClicks ||
      b.impressions - a.impressions ||
      a.query.localeCompare(b.query)
  );

  return {
    suggestions: suggestions.slice(0, options.limit),
    totals: { candidates: candidates.length, alreadyTracked, brandExcluded }
  };
}
