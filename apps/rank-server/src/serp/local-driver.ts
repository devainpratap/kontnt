import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Browser, BrowserContext } from "playwright-core";

import { rankConfig } from "../config";
import { classifyPage, extractFeatures, extractResults, findClientPosition } from "./parser";
import type { SerpFetchResult, SerpProvider, SerpQuery } from "./types";

/**
 * Free rank checking through the operator's own Chrome.
 *
 * Design notes, all of which exist because Google actively resists this:
 *
 *  - System Chrome via playwright-core, not bundled Chromium. No 300MB
 *    download, and real Chrome presents a far more ordinary fingerprint.
 *  - A persistent profile on disk, so cookies and a solved consent screen
 *    survive restarts instead of being re-triggered on every run.
 *  - One page at a time. Concurrency is what gets an IP flagged fastest.
 *  - Any unrecognised page is `blocked`, never `ok` with zero results.
 *
 * This driver is deliberately not load-bearing: it sits behind SerpProvider so
 * that switching to a paid source when Google tightens up is an .env change.
 */

const NAVIGATION_TIMEOUT_MS = 30_000;

/** A current, ordinary desktop Chrome UA. Mobile checks use a phone profile. */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 393, height: 852 };
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let context: BrowserContext | null = null;
let browser: Browser | null = null;

/**
 * Locate the operator's installed Chrome.
 *
 * Playwright's `channel: "chrome"` finds it at launch time, but the readiness
 * probe needs an answer without launching a browser, so the standard install
 * locations are checked directly.
 */
export function findSystemChrome(): string | null {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium"
        ]
      : process.platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function loadPlaywright() {
  // Imported lazily so the server boots (and every other route works) even if
  // playwright-core or Chrome is missing on this machine.
  const { chromium } = await import("playwright-core");
  return chromium;
}

async function getContext(device: SerpQuery["device"]): Promise<BrowserContext> {
  if (context) {
    return context;
  }

  const chromium = await loadPlaywright();
  const profileDir = join(rankConfig.dataRoot, "browser-profile", device);
  await mkdir(profileDir, { recursive: true });

  // A persistent context keeps cookies and consent state between runs, which
  // is the single biggest factor in not being re-challenged constantly.
  context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: rankConfig.serpHeadless,
    viewport: device === "mobile" ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT,
    userAgent: device === "mobile" ? MOBILE_UA : undefined,
    locale: "en-US",
    args: [
      // Removes the navigator.webdriver flag that trivially identifies automation.
      "--disable-blink-features=AutomationControlled",
      "--no-default-browser-check",
      "--no-first-run"
    ]
  });

  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  return context;
}

/**
 * Google's search URL for a query.
 *
 * `num` asks for a deeper page, `gl`/`hl` set the market, and `pws=0` disables
 * personalisation so the result reflects a neutral searcher rather than this
 * profile's history.
 */
export function buildSearchUrl(query: SerpQuery, startAt = 0): string {
  const params = new URLSearchParams({
    q: query.keyword,
    hl: "en",
    gl: query.country,
    pws: "0",
    // Suppresses the "showing results for" auto-correction, which would
    // silently check a different keyword than the one being tracked.
    nfpr: "1"
  });

  // Deliberately no `num` parameter. Google deprecated it in 2025 — it is now
  // ignored (ten results are returned regardless) and sending it is an extra
  // signal that the request is automated. Depth comes from `start` instead.
  if (startAt > 0) {
    params.set("start", String(startAt));
  }

  if (query.location) {
    params.set("uule", encodeCanonicalLocation(query.location));
  }

  return `https://www.google.com/search?${params.toString()}`;
}

/** Results per Google page, now that `num` is ignored. */
export const RESULTS_PER_PAGE = 10;

/**
 * Google's uule encoding for a canonical location name: the fixed prefix
 * `w+CAIQICI`, a single character encoding the length of the *name* against the
 * base64 alphabet, then the base64-encoded name.
 *
 * The previous version used a 26-letter alphabet indexed by `length % 26`, which
 * produced an invalid length character for almost every location. Google then
 * ignored the uule and silently fell back to the request IP's location - the
 * bug behind rank readings that matched a proxy's vantage instead of the target
 * city. An unrecognised (but well-formed) value still degrades to a national
 * result rather than erroring.
 */
const UULE_LENGTH_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function encodeCanonicalLocation(location: string): string {
  const encoded = Buffer.from(location, "utf8").toString("base64");
  const lengthChar = UULE_LENGTH_ALPHABET[location.length] ?? "A";
  return `w+CAIQICI${lengthChar}${encoded}`;
}

export const localSerpProvider: SerpProvider = {
  name: "local",

  async getStatus() {
    // A readiness probe must not perform a search, so this checks for the
    // Chrome binary on disk rather than launching anything.
    const chromePath = findSystemChrome();

    if (!chromePath) {
      return {
        name: "local",
        available: false,
        message: "Google Chrome was not found. Install Chrome, or set SERP_PROVIDER=dataforseo in .env."
      };
    }

    try {
      await loadPlaywright();
    } catch {
      return {
        name: "local",
        available: false,
        message: "playwright-core is not installed. Run npm install, or set SERP_PROVIDER=dataforseo."
      };
    }

    return {
      name: "local",
      available: true,
      message:
        `Local Chrome ready (${rankConfig.serpHeadless ? "headless" : "headed"}, top ` +
        `${rankConfig.serpMaxPages * RESULTS_PER_PAGE}). Throttled to ${rankConfig.serpMaxChecksPerDay}/day, ` +
        `${Math.round(rankConfig.serpMinDelayMs / 1000)}-${Math.round(rankConfig.serpMaxDelayMs / 1000)}s apart.` +
        (rankConfig.serpHeadless
          ? " Warning: Google blocks headless Chrome — set SERP_HEADLESS=false."
          : "")
    };
  },

  /**
   * Fetch a keyword, paginating until the client is found or the page budget
   * runs out.
   *
   * Each Google page costs one request, so depth is expensive in exactly the
   * currency that matters here. `stopWhenDomainFound` means a keyword ranking
   * on page one costs a single request and only poor performers pay for depth,
   * so cost scales with how badly the client ranks.
   */
  async fetch(query, signal): Promise<SerpFetchResult> {
    if (signal?.aborted) {
      return { status: "error", results: [], features: [], raw: null, errorMessage: "Cancelled." };
    }

    const collected: ReturnType<typeof extractResults> = [];
    const features = new Set<string>();
    const pagesFetched: Array<{ url: string; finalUrl: string; results: number }> = [];

    try {
      const ctx = await getContext(query.device);

      for (let pageIndex = 0; pageIndex < rankConfig.serpMaxPages; pageIndex += 1) {
        if (signal?.aborted) {
          break;
        }

        const url = buildSearchUrl(query, pageIndex * RESULTS_PER_PAGE);
        const page = await ctx.newPage();

        try {
          const response = await page.goto(url, { waitUntil: "domcontentloaded" });
          const finalUrl = page.url();
          const html = await page.content();

          const classification = classifyPage(html, finalUrl);

          if (classification.kind !== "results") {
            // A block partway through is still a block: returning the pages we
            // did get would understate depth and could report a real ranking
            // as "not found".
            return {
              status: "blocked",
              results: [],
              features: [],
              raw: {
                blockedOnPage: pageIndex + 1,
                url,
                finalUrl,
                httpStatus: response?.status() ?? null,
                htmlLength: html.length,
                pagesFetched
              },
              errorMessage: classification.reason
            };
          }

          const pageResults = extractResults(html, RESULTS_PER_PAGE * 2);
          for (const feature of extractFeatures(html)) {
            features.add(feature);
          }

          pagesFetched.push({ url, finalUrl, results: pageResults.length });

          // Renumber into a single continuous ranking across pages.
          for (const item of pageResults) {
            collected.push({ ...item, position: collected.length + 1 });
          }

          // Google ran out of results before the page budget did.
          if (pageResults.length === 0) {
            break;
          }

          // Early exit: the client has been located, so deeper pages would
          // cost requests without changing the answer.
          if (query.stopWhenDomainFound && findClientPosition(collected, query.stopWhenDomainFound)) {
            break;
          }
        } finally {
          await page.close().catch(() => undefined);
        }

        // Short human-ish pause between pages of the same keyword. The long
        // inter-keyword delay is applied by the queue, not here.
        if (pageIndex < rankConfig.serpMaxPages - 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000 + Math.random() * 4000));
        }
      }

      if (collected.length === 0) {
        // A readable page yielding nothing means Google's markup changed, not
        // that every site vanished. Unknown, never "ranks nowhere".
        return {
          status: "blocked",
          results: [],
          features: [],
          raw: { pagesFetched },
          errorMessage: "Results pages loaded but no organic results parsed — Google markup may have changed."
        };
      }

      return {
        status: "ok",
        results: collected,
        features: [...features] as SerpFetchResult["features"],
        raw: { pagesFetched, resultCount: collected.length, depth: rankConfig.serpMaxPages * RESULTS_PER_PAGE },
        errorMessage: null
      };
    } catch (error) {
      return {
        status: "error",
        results: [],
        features: [],
        raw: { pagesFetched },
        errorMessage: error instanceof Error ? error.message : "Unknown browser failure."
      };
    }
  },

  async dispose() {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    context = null;
    browser = null;
  }
};
