import type { RankCheckStatus, SerpFeature } from "@rankos/shared";

/**
 * The one interface every rank source implements.
 *
 * This is the seam that keeps scraping from becoming load-bearing
 * architecture. The local browser driver, a paid API, and anything added later
 * are interchangeable behind it, so switching when Google starts blocking is a
 * change to SERP_PROVIDER in .env rather than a rewrite.
 */

export type SerpQuery = {
  keyword: string;
  /** ISO-3166 alpha-2, lowercased. Drives Google's gl parameter. */
  country: string;
  device: "desktop" | "mobile";
  /** Optional city/region for local intent. */
  location?: string | null;
  /**
   * When set, pagination stops as soon as this domain appears.
   *
   * Each extra Google page is another request and another chance of being
   * blocked, so a keyword ranking on page one should cost one request. Only
   * poorly-ranking keywords pay for depth.
   */
  stopWhenDomainFound?: string | null;
};

export type SerpResultItem = {
  position: number;
  url: string;
  domain: string;
  title: string | null;
};

/**
 * A fetch outcome.
 *
 * `status` is deliberately not a boolean. "We fetched the page and the client
 * is not in it" and "we were blocked and do not know" are different facts, and
 * collapsing them would report a scraper failure to a client as a ranking
 * collapse. Only `ok` may ever produce a stored position.
 */
export type SerpFetchResult = {
  status: Extract<RankCheckStatus, "ok" | "blocked" | "error">;
  results: SerpResultItem[];
  features: SerpFeature[];
  /** Raw payload persisted to disk for after-the-fact inspection. */
  raw: unknown;
  errorMessage: string | null;
};

export type SerpProviderStatusResult = {
  name: string;
  available: boolean;
  message: string;
};

export type SerpProvider = {
  name: string;
  /** Cheap readiness probe — must not perform a search. */
  getStatus(): Promise<SerpProviderStatusResult>;
  fetch(query: SerpQuery, signal?: AbortSignal): Promise<SerpFetchResult>;
  /** Release any long-lived resource (a browser, a pool) on shutdown. */
  dispose?(): Promise<void>;
};

/** Depth to fetch. Beyond 100 Google's results stop being meaningful. */
export const SERP_DEPTH = 100;

/** Stored per check, so competitor movement is available without a refetch. */
export const STORED_RESULT_COUNT = 20;
