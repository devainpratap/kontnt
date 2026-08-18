import type { SerpFeature } from "@rankos/shared";

import { rankConfig } from "../config";
import { extractDomain } from "./parser";
import type { SerpFetchResult, SerpProvider, SerpQuery, SerpResultItem } from "./types";

/**
 * SerpApi — the overflow provider.
 *
 * 250 searches per month, recurring, no card, capped at 50/hour. Small, but it
 * is the safety net that keeps checks running when the primary free tier is
 * spent, and its `organic_results[].position` is Google's own ranking rather
 * than an index we would have to renumber.
 */

const ENDPOINT = "https://serpapi.com/search";

type SerpApiResponse = {
  organic_results?: Array<{ position?: number; link?: string; title?: string }>;
  related_questions?: unknown[];
  answer_box?: unknown;
  local_results?: unknown;
  inline_images?: unknown;
  ai_overview?: unknown;
  error?: string;
  search_metadata?: { status?: string };
};

/**
 * Map SerpApi's organic results onto our shape.
 *
 * Positions are renumbered contiguously from 1 rather than trusting the
 * provider's `position`, which can skip values when Google interleaves
 * non-organic blocks. A tracked rank must mean "nth organic result", the same
 * definition every other driver uses, or history becomes incomparable across a
 * provider switch.
 */
export function mapSerpApiResults(payload: SerpApiResponse): SerpResultItem[] {
  const results: SerpResultItem[] = [];
  const seen = new Set<string>();

  for (const item of payload.organic_results ?? []) {
    const url = item.link;
    if (!url || seen.has(url)) {
      continue;
    }
    const domain = extractDomain(url);
    if (!domain) {
      continue;
    }
    seen.add(url);
    results.push({ position: results.length + 1, url, domain, title: item.title ?? null });
  }

  return results;
}

export function mapSerpApiFeatures(payload: SerpApiResponse): SerpFeature[] {
  const features: SerpFeature[] = [];
  if (payload.related_questions?.length) features.push("people-also-ask");
  if (payload.answer_box) features.push("featured-snippet");
  if (payload.ai_overview) features.push("ai-overview");
  if (payload.local_results) features.push("local-pack");
  return features;
}

/**
 * Google's country-specific domain, matched to the search country.
 *
 * SerpApi defaults `google_domain` to google.com; pairing it with the `gl`
 * country (google.co.in for gl=in) makes the SERP reflect what a searcher in
 * that country actually sees, instead of a google.com view biased only by gl.
 * Unknown countries fall back to google.com, which is Google's own default.
 */
const GOOGLE_DOMAINS: Record<string, string> = {
  in: "google.co.in",
  us: "google.com",
  gb: "google.co.uk",
  uk: "google.co.uk",
  ca: "google.ca",
  au: "google.com.au",
  nz: "google.co.nz",
  ie: "google.ie",
  ae: "google.ae",
  sa: "google.com.sa",
  sg: "google.com.sg",
  my: "google.com.my",
  ph: "google.com.ph",
  id: "google.co.id",
  pk: "google.com.pk",
  bd: "google.com.bd",
  lk: "google.lk",
  za: "google.co.za",
  ng: "google.com.ng",
  ke: "google.co.ke",
  de: "google.de",
  fr: "google.fr",
  es: "google.es",
  it: "google.it",
  nl: "google.nl",
  br: "google.com.br",
  mx: "google.com.mx",
  jp: "google.co.jp"
};

export function googleDomainForCountry(country: string): string {
  return GOOGLE_DOMAINS[country.toLowerCase()] ?? "google.com";
}

/**
 * Build the SerpApi request parameters for one page of a query.
 *
 * Extracted as a pure function so the exact parameters sent to Google - the
 * thing that decides whether a ranking is correct - are unit-tested rather than
 * buried in the fetch loop.
 */
export function buildSerpApiParams(query: SerpQuery, pageIndex: number, apiKey: string): URLSearchParams {
  const params = new URLSearchParams({
    engine: "google",
    q: query.keyword,
    // Match the Google ccTLD to the country so the SERP is localized the way a
    // real searcher in that country sees it, not a plain google.com view.
    google_domain: googleDomainForCountry(query.country),
    gl: query.country,
    hl: "en",
    device: query.device,
    // Always fetch a fresh SERP. A cached result would defeat rank tracking, and
    // at the weekly cadence these checks run they never fall inside SerpApi's
    // ~1h cache window anyway, so this costs nothing in practice (a cached hit
    // would not have been served regardless).
    no_cache: "true",
    // Google deprecated `num` in 2025, so depth comes from `start` pagination.
    start: String(pageIndex * 10),
    api_key: apiKey
  });
  if (query.location) {
    params.set("location", query.location);
  }
  return params;
}

export const serpApiProvider: SerpProvider = {
  name: "serpapi",

  async getStatus() {
    const configured = Boolean(rankConfig.serpApiKey);
    return {
      name: "serpapi",
      available: configured,
      message: configured
        ? `SerpApi key set. ${rankConfig.monthlyFree.serpapi} free searches/month, 50/hour.`
        : "Set SERPAPI_API_KEY in .env — 250 free searches/month, no card required."
    };
  },

  async fetch(query: SerpQuery, signal?: AbortSignal): Promise<SerpFetchResult> {
    if (!rankConfig.serpApiKey) {
      return { status: "error", results: [], features: [], raw: null, errorMessage: "SERPAPI_API_KEY is not set." };
    }

    // Google deprecated the `num` parameter in 2025, so depth comes from `start`
    // pagination - the same as the browser driver. Each page is one fast API
    // call (~1s) rather than a ~10s proxied page load, and early exit means a
    // keyword ranking on page one costs a single request.
    const collected: SerpResultItem[] = [];
    const features = new Set<SerpFeature>();
    let lastStatus: number | null = null;

    try {
      for (let pageIndex = 0; pageIndex < rankConfig.serpMaxPages; pageIndex += 1) {
        if (signal?.aborted) {
          break;
        }

        const params = buildSerpApiParams(query, pageIndex, rankConfig.serpApiKey);

        const response = await fetch(`${ENDPOINT}?${params.toString()}`, { signal });
        lastStatus = response.status;
        const payload = (await response.json().catch(() => ({}))) as SerpApiResponse;

        if (!response.ok || payload.error) {
          // 429 = the hourly/monthly cap is hit. Recoverable by failing over to
          // the next provider, so it is an error the chain acts on, not a block.
          // If earlier pages already found the client, keep that result.
          if (collected.length > 0) {
            break;
          }
          return {
            status: "error",
            results: [],
            features: [],
            raw: payload,
            errorMessage: payload.error ?? `SerpApi HTTP ${response.status}.`
          };
        }

        const pageResults = mapSerpApiResults(payload);
        for (const feature of mapSerpApiFeatures(payload)) {
          features.add(feature);
        }

        // Renumber into one continuous ranking across pages.
        for (const item of pageResults) {
          collected.push({ ...item, position: collected.length + 1 });
        }

        if (pageResults.length === 0) {
          break; // Google returned nothing further.
        }

        if (
          query.stopWhenDomainFound &&
          collected.some(
            (item) =>
              item.domain === query.stopWhenDomainFound ||
              item.domain.endsWith(`.${query.stopWhenDomainFound}`)
          )
        ) {
          break; // Client located - deeper pages would cost credits for nothing.
        }
      }

      if (collected.length === 0) {
        // A successful call with no organic results is unexpected, not proof
        // that nothing ranks. Unknown, never "ranks nowhere".
        return {
          status: "blocked",
          results: [],
          features: [],
          raw: { httpStatus: lastStatus },
          errorMessage: "SerpApi returned no organic results."
        };
      }

      return {
        status: "ok",
        results: collected,
        features: [...features],
        raw: { resultCount: collected.length, pages: Math.ceil(collected.length / 10) },
        errorMessage: null
      };
    } catch (error) {
      return {
        status: "error",
        results: [],
        features: [],
        raw: null,
        errorMessage: error instanceof Error ? error.message : "SerpApi request failed."
      };
    }
  }
};
