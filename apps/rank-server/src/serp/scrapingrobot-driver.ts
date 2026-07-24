import { rankConfig } from "../config";
import { buildSearchUrl, RESULTS_PER_PAGE } from "./local-driver";
import { classifyPage, extractFeatures, extractResults } from "./parser";
import type { SerpFetchResult, SerpProvider, SerpQuery, SerpResultItem } from "./types";

/**
 * ScrapingRobot — the primary free provider.
 *
 * 5,000 scrapes per month, recurring, credits never expire, no card. That
 * covers this workload outright, which is what makes free rank tracking viable
 * at all.
 *
 * **Why this driver fetches HTML instead of using a structured SERP module.**
 * ScrapingRobot's public API reference 404s, so the name and response shape of
 * their Google module could not be confirmed. What *is* documented is the
 * generic HTML module. So this driver uses ScrapingRobot purely as a fetcher —
 * it asks for the same Google URL the browser driver would load, and hands the
 * HTML to the parser that already has 32 tests against it, including the
 * blocked-page detection.
 *
 * The result: the risky, changeable part (Google's markup) is handled by code
 * we have already proven, and the provider is reduced to "give me this page
 * from an IP that is not mine" — which is the only thing we actually need from
 * it. If their structured module later turns out to be better, swapping is
 * contained to this file.
 */

const ENDPOINT = "https://api.scrapingrobot.com";

type ScrapingRobotResponse = {
  result?: string | { html?: string; content?: string };
  status?: string;
  message?: string;
  error?: string;
  // Some modules nest the payload; checked defensively below.
  data?: unknown;
};

/**
 * Pull the HTML out of a ScrapingRobot response.
 *
 * The envelope shape is not fully documented, so the plausible shapes are each
 * tried rather than assuming one. Returning null (instead of an empty string)
 * keeps "no HTML found" distinguishable from "page was empty".
 */
export function extractHtmlPayload(payload: ScrapingRobotResponse): string | null {
  const { result } = payload;

  if (typeof result === "string" && result.length > 0) {
    return result;
  }

  if (result && typeof result === "object") {
    if (typeof result.html === "string" && result.html.length > 0) {
      return result.html;
    }
    if (typeof result.content === "string" && result.content.length > 0) {
      return result.content;
    }
  }

  if (typeof payload.data === "string" && payload.data.length > 0) {
    return payload.data;
  }

  return null;
}

export const scrapingRobotProvider: SerpProvider = {
  name: "scrapingrobot",

  async getStatus() {
    const configured = Boolean(rankConfig.scrapingRobotApiKey);
    return {
      name: "scrapingrobot",
      available: configured,
      message: configured
        ? `ScrapingRobot key set. ${rankConfig.monthlyFree.scrapingrobot} free scrapes/month, credits never expire.`
        : "Set SCRAPINGROBOT_API_KEY in .env — 5,000 free scrapes/month, no card required."
    };
  },

  async fetch(query: SerpQuery, signal?: AbortSignal): Promise<SerpFetchResult> {
    if (!rankConfig.scrapingRobotApiKey) {
      return {
        status: "error",
        results: [],
        features: [],
        raw: null,
        errorMessage: "SCRAPINGROBOT_API_KEY is not set."
      };
    }

    const collected: SerpResultItem[] = [];
    const features = new Set<string>();
    const pagesFetched: Array<{ url: string; results: number }> = [];

    try {
      for (let pageIndex = 0; pageIndex < rankConfig.serpMaxPages; pageIndex += 1) {
        if (signal?.aborted) {
          break;
        }

        const searchUrl = buildSearchUrl(query, pageIndex * RESULTS_PER_PAGE);

        const response = await fetch(`${ENDPOINT}?token=${encodeURIComponent(rankConfig.scrapingRobotApiKey)}`, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: searchUrl, module: rankConfig.scrapingRobotModule })
        });

        const payload = (await response.json().catch(() => ({}))) as ScrapingRobotResponse;

        if (!response.ok) {
          return {
            status: "error",
            results: [],
            features: [],
            raw: payload,
            errorMessage:
              payload.message ?? payload.error ?? `ScrapingRobot HTTP ${response.status}.`
          };
        }

        const html = extractHtmlPayload(payload);

        if (!html) {
          return {
            status: "error",
            results: [],
            features: [],
            raw: payload,
            errorMessage: payload.message ?? payload.error ?? "ScrapingRobot returned no HTML."
          };
        }

        // Reuse the proven classifier: even fetched through a third party, the
        // page can still be a Google interstitial, and that must never be read
        // as "the client ranks nowhere".
        const classification = classifyPage(html, searchUrl);
        if (classification.kind !== "results") {
          return {
            status: "blocked",
            results: [],
            features: [],
            raw: { blockedOnPage: pageIndex + 1, htmlLength: html.length, pagesFetched },
            errorMessage: classification.reason
          };
        }

        const pageResults = extractResults(html, RESULTS_PER_PAGE * 2);
        for (const feature of extractFeatures(html)) {
          features.add(feature);
        }
        pagesFetched.push({ url: searchUrl, results: pageResults.length });

        for (const item of pageResults) {
          collected.push({ ...item, position: collected.length + 1 });
        }

        if (pageResults.length === 0) {
          break;
        }

        // Same early exit as the browser driver: once the client is located,
        // deeper pages cost credits without changing the answer.
        if (
          query.stopWhenDomainFound &&
          collected.some(
            (item) =>
              item.domain === query.stopWhenDomainFound ||
              item.domain.endsWith(`.${query.stopWhenDomainFound}`)
          )
        ) {
          break;
        }
      }

      if (collected.length === 0) {
        return {
          status: "blocked",
          results: [],
          features: [],
          raw: { pagesFetched },
          errorMessage: "Pages fetched but no organic results parsed — Google markup may have changed."
        };
      }

      return {
        status: "ok",
        results: collected,
        features: [...features] as SerpFetchResult["features"],
        raw: { pagesFetched, resultCount: collected.length },
        errorMessage: null
      };
    } catch (error) {
      return {
        status: "error",
        results: [],
        features: [],
        raw: { pagesFetched },
        errorMessage: error instanceof Error ? error.message : "ScrapingRobot request failed."
      };
    }
  }
};
