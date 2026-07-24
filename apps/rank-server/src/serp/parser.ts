import * as cheerio from "cheerio";

import type { SerpFeature } from "@rankos/shared";

import type { SerpResultItem } from "./types";

/**
 * Parsing a Google results page.
 *
 * Two jobs, and the second matters more than the first:
 *
 *  1. pull the organic results in order;
 *  2. decide whether this page is a results page at all.
 *
 * A CAPTCHA, a consent interstitial, or an empty shell parses to zero results.
 * If that were reported as "the client does not rank", a blocked scraper would
 * look exactly like a ranking collapse — which is the single worst thing this
 * system could tell an agency about its client. So classification runs first
 * and is deliberately conservative: anything that smells like an interstitial
 * is `blocked`, never `ok` with no results.
 */

export type PageClassification =
  | { kind: "results" }
  | { kind: "blocked"; reason: string }
  | { kind: "consent"; reason: string };

/**
 * Markers matched against the **final URL only**.
 *
 * These must never be matched against the page body: a normal results page
 * embeds a link to /sorry/index in its scripts, so a body-wide search flags
 * every successful fetch as blocked. That false positive is as damaging as the
 * one this module exists to prevent — it throws away real rankings — and it is
 * why the URL and body marker sets are kept strictly separate.
 */
const BLOCKED_URL_MARKERS = ["/sorry/", "/interstitial"];

const CONSENT_URL_MARKERS = ["consent.google.", "/consent?"];

/**
 * Phrases matched against the page body.
 *
 * Deliberately long and specific. Short tokens like "recaptcha" or "accept all"
 * appear in the markup of ordinary results pages and cannot be used here.
 */
const BLOCKED_BODY_MARKERS = [
  "our systems have detected unusual traffic",
  "unusual traffic from your computer network",
  "your computer or network may be sending automated queries"
];

const CONSENT_BODY_MARKERS = ["before you continue to google"];

/** Hosts that are Google's own surfaces, never an organic competitor result. */
const GOOGLE_HOSTS = [
  "google.",
  "googleusercontent.com",
  "gstatic.com",
  "youtube.com/redirect",
  "accounts.google",
  "policies.google",
  "support.google",
  "webcache.googleusercontent.com"
];

/**
 * Decide what kind of page this is before trusting any result count.
 *
 * Ordering matters: CAPTCHA is checked before consent, and both before the
 * "does it look like results" test, so a blocked page can never fall through
 * to being read as an empty SERP.
 */
export function classifyPage(html: string, finalUrl = ""): PageClassification {
  const url = finalUrl.toLowerCase();
  const body = html.toLowerCase();

  // 1. The URL is the reliable signal: Google redirects a challenged request
  //    to /sorry/, so this catches a block regardless of page content.
  for (const marker of BLOCKED_URL_MARKERS) {
    if (url.includes(marker)) {
      return { kind: "blocked", reason: `Google redirected to a challenge page ("${marker}").` };
    }
  }

  for (const marker of CONSENT_URL_MARKERS) {
    if (url.includes(marker)) {
      return { kind: "consent", reason: `Redirected to a consent screen ("${marker}").` };
    }
  }

  // 2. Body phrases, only for the case where Google serves the interstitial
  //    inline without redirecting.
  for (const marker of BLOCKED_BODY_MARKERS) {
    if (body.includes(marker)) {
      return { kind: "blocked", reason: `Google interstitial detected ("${marker}").` };
    }
  }

  for (const marker of CONSENT_BODY_MARKERS) {
    if (body.includes(marker)) {
      return { kind: "consent", reason: `Consent screen detected ("${marker}").` };
    }
  }

  // 3. A real SERP always carries a results container. Its absence means we got
  //    something other than search results, whatever it was.
  const looksLikeResults =
    body.includes('id="search"') ||
    body.includes('id="rso"') ||
    body.includes("id='search'") ||
    body.includes('id="botstuff"');

  if (!looksLikeResults) {
    return { kind: "blocked", reason: "Response did not contain a Google results container." };
  }

  return { kind: "results" };
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isGoogleOwnedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return GOOGLE_HOSTS.some((host) => lower.includes(host));
}

/**
 * Google sometimes wraps result links as /url?q=<real>. Unwrap so the stored
 * URL is the destination rather than a redirector.
 */
export function normaliseResultUrl(href: string): string | null {
  if (!href) {
    return null;
  }

  let candidate = href;

  if (candidate.startsWith("/url?")) {
    const params = new URLSearchParams(candidate.slice(candidate.indexOf("?") + 1));
    candidate = params.get("q") ?? params.get("url") ?? "";
  }

  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  }

  if (!/^https?:\/\//i.test(candidate)) {
    return null;
  }

  try {
    const url = new URL(candidate);
    // Tracking parameters vary per fetch; stripping them keeps the same page
    // from looking like a different URL between checks.
    for (const param of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "ved", "usg"]) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Extract organic results in page order.
 *
 * Deliberately structural rather than class-based: Google's CSS class names
 * change constantly, but "an anchor that contains an h3 heading" has described
 * an organic result for years. Results are deduplicated by URL, keeping the
 * first (highest) occurrence, because sitelinks repeat the parent URL.
 */
export function extractResults(html: string, limit = 100): SerpResultItem[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: SerpResultItem[] = [];

  $("a:has(h3)").each((_, element) => {
    if (results.length >= limit) {
      return false;
    }

    const anchor = $(element);
    const href = anchor.attr("href") ?? "";
    const url = normaliseResultUrl(href);

    if (!url || isGoogleOwnedUrl(url)) {
      return undefined;
    }

    const domain = extractDomain(url);
    if (!domain || seen.has(url)) {
      return undefined;
    }
    seen.add(url);

    const title = anchor.find("h3").first().text().trim() || null;

    results.push({ position: results.length + 1, url, domain, title });
    return undefined;
  });

  return results;
}

/** Detect the SERP features present, so layout shifts are visible over time. */
export function extractFeatures(html: string): SerpFeature[] {
  const lower = html.toLowerCase();
  const features: SerpFeature[] = [];

  const has = (...markers: string[]) => markers.some((marker) => lower.includes(marker));

  if (has("people also ask", 'jsname="yeplwe"', "related-question-pair")) features.push("people-also-ask");
  if (has("featured snippet", "kp-blk", 'data-attrid="wa:/description"')) features.push("featured-snippet");
  if (has("ai overview", "ai-overview", "generative ai")) features.push("ai-overview");
  if (has("local pack", "maps.google", 'data-attrid="kc:/local"', "rlfl__tls")) features.push("local-pack");
  if (has("shopping results", "commercial-unit", "pla-unit")) features.push("shopping");
  if (has("images for", 'id="imagebox"', "isv-r")) features.push("image-pack");
  if (has("videos for", "video-voyager")) features.push("video-pack");

  return features;
}

/**
 * The client's position, or null when it does not appear.
 *
 * Matches the registrable domain and its subdomains, so blog.example.com
 * counts for example.com but notexample.com does not.
 */
export function findClientPosition(
  results: SerpResultItem[],
  clientDomain: string
): { position: number; url: string } | null {
  const target = clientDomain.replace(/^www\./, "").toLowerCase();

  for (const result of results) {
    if (result.domain === target || result.domain.endsWith(`.${target}`)) {
      return { position: result.position, url: result.url };
    }
  }

  return null;
}
