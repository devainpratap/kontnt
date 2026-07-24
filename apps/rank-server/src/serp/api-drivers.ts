import type { SerpFeature } from "@rankos/shared";

import { rankConfig } from "../config";
import { extractDomain } from "./parser";
import { SERP_DEPTH, type SerpFetchResult, type SerpProvider, type SerpQuery } from "./types";

/**
 * Paid SERP sources — the escape hatch.
 *
 * The local browser driver is free but will eventually be throttled or blocked.
 * These implement the same interface, so switching is a change to
 * SERP_PROVIDER in .env. At the plan's scale (roughly 800 keywords checked
 * weekly) DataForSEO's standard queue costs about $2/month, which is the point:
 * the fallback is cheap enough that scraping never has to be fought.
 */

type ApiResultItem = { position: number; url: string; domain: string; title: string | null };

function toResults(items: Array<{ url?: string; title?: string | null }>): ApiResultItem[] {
  const seen = new Set<string>();
  const results: ApiResultItem[] = [];

  for (const item of items) {
    const url = item.url;
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

// --------------------------------------------------------------- DataForSEO

export const dataForSeoProvider: SerpProvider = {
  name: "dataforseo",

  async getStatus() {
    const configured = Boolean(rankConfig.dataForSeoLogin && rankConfig.dataForSeoPassword);
    return {
      name: "dataforseo",
      available: configured,
      message: configured
        ? "DataForSEO credentials are set. Standard queue costs about $0.60 per 1,000 checks."
        : "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env to use this provider."
    };
  },

  async fetch(query: SerpQuery, signal?: AbortSignal): Promise<SerpFetchResult> {
    const auth = Buffer.from(`${rankConfig.dataForSeoLogin}:${rankConfig.dataForSeoPassword}`).toString("base64");

    try {
      const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
        method: "POST",
        signal,
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            keyword: query.keyword,
            language_code: "en",
            location_name: query.location ?? undefined,
            location_code: query.location ? undefined : countryToLocationCode(query.country),
            device: query.device,
            depth: SERP_DEPTH
          }
        ])
      });

      if (!response.ok) {
        return {
          status: "error",
          results: [],
          features: [],
          raw: null,
          errorMessage: `DataForSEO HTTP ${response.status}.`
        };
      }

      const payload = (await response.json()) as {
        tasks?: Array<{
          status_message?: string;
          result?: Array<{ items?: Array<{ type?: string; rank_absolute?: number; url?: string; title?: string }> }>;
        }>;
      };

      const items = payload.tasks?.[0]?.result?.[0]?.items ?? [];
      const organic = items.filter((item) => item.type === "organic");

      if (organic.length === 0) {
        // Same rule as the local driver: an empty response is unknown, not
        // "ranks nowhere".
        return {
          status: "blocked",
          results: [],
          features: [],
          raw: payload,
          errorMessage: payload.tasks?.[0]?.status_message ?? "DataForSEO returned no organic results."
        };
      }

      return {
        status: "ok",
        results: toResults(organic),
        features: featuresFromTypes(items.map((item) => item.type ?? "")),
        raw: payload,
        errorMessage: null
      };
    } catch (error) {
      return {
        status: "error",
        results: [],
        features: [],
        raw: null,
        errorMessage: error instanceof Error ? error.message : "DataForSEO request failed."
      };
    }
  }
};

/** DataForSEO location codes for the markets this agency works in. */
function countryToLocationCode(country: string): number {
  const codes: Record<string, number> = {
    in: 2356,
    us: 2840,
    gb: 2826,
    au: 2036,
    ca: 2124,
    ae: 2784,
    sg: 2702
  };
  return codes[country.toLowerCase()] ?? 2356;
}

function featuresFromTypes(types: string[]): SerpFeature[] {
  const features: SerpFeature[] = [];
  const set = new Set(types);

  if (set.has("people_also_ask")) features.push("people-also-ask");
  if (set.has("featured_snippet")) features.push("featured-snippet");
  if (set.has("ai_overview")) features.push("ai-overview");
  if (set.has("local_pack")) features.push("local-pack");
  if (set.has("shopping")) features.push("shopping");
  if (set.has("images")) features.push("image-pack");
  if (set.has("video")) features.push("video-pack");

  return features;
}

// ------------------------------------------------------------------- Serper

export const serperProvider: SerpProvider = {
  name: "serper",

  async getStatus() {
    const configured = Boolean(rankConfig.serperApiKey);
    return {
      name: "serper",
      available: configured,
      message: configured
        ? "Serper API key is set. New accounts include 2,500 free credits."
        : "Set SERPER_API_KEY in .env to use this provider."
    };
  },

  async fetch(query: SerpQuery, signal?: AbortSignal): Promise<SerpFetchResult> {
    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        signal,
        headers: { "X-API-KEY": rankConfig.serperApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          q: query.keyword,
          gl: query.country,
          hl: "en",
          num: SERP_DEPTH,
          location: query.location ?? undefined
        })
      });

      if (!response.ok) {
        return {
          status: "error",
          results: [],
          features: [],
          raw: null,
          errorMessage: `Serper HTTP ${response.status}.`
        };
      }

      const payload = (await response.json()) as {
        organic?: Array<{ link?: string; title?: string }>;
        peopleAlsoAsk?: unknown[];
        answerBox?: unknown;
      };

      const organic = payload.organic ?? [];

      if (organic.length === 0) {
        return {
          status: "blocked",
          results: [],
          features: [],
          raw: payload,
          errorMessage: "Serper returned no organic results."
        };
      }

      const features: SerpFeature[] = [];
      if (payload.peopleAlsoAsk?.length) features.push("people-also-ask");
      if (payload.answerBox) features.push("featured-snippet");

      return {
        status: "ok",
        results: toResults(organic.map((item) => ({ url: item.link, title: item.title }))),
        features,
        raw: payload,
        errorMessage: null
      };
    } catch (error) {
      return {
        status: "error",
        results: [],
        features: [],
        raw: null,
        errorMessage: error instanceof Error ? error.message : "Serper request failed."
      };
    }
  }
};
