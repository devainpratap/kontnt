import type { GscPropertyType } from "@rankos/shared";

import { ApiError } from "../lib/api-error";

/**
 * Thin client over the Search Console API.
 *
 * Two constraints shape everything here:
 *   - a single request returns at most 25,000 rows, so anything real needs
 *     pagination via startRow;
 *   - the API is quota-limited per minute and per day, and a 429 during a
 *     16-month backfill is normal rather than exceptional, so retries back off
 *     instead of failing the run.
 */

const SITES_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";
const SEARCH_ANALYTICS_ENDPOINT = "https://www.googleapis.com/webmasters/v3/sites";

/** Google's hard per-request row cap. */
export const MAX_ROWS_PER_REQUEST = 25_000;

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;

export type GscSite = {
  siteUrl: string;
  permissionLevel: string;
  propertyType: GscPropertyType;
};

export type SearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchAnalyticsQuery = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  startRow?: number;
  /** Search Console splits data by type; "web" excludes image/video noise. */
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  dataState?: "final" | "all";
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429 and 5xx are transient; 401/403/400 are not and must surface immediately. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

type FetchOptions = {
  accessToken: string;
  signal?: AbortSignal;
};

async function googleFetch(url: string, init: RequestInit, options: FetchOptions): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (options.signal?.aborted) {
      throw new ApiError("Sync cancelled.", 499, "SYNC_CANCELLED");
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: options.signal,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      // Network-level failure: worth retrying.
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === MAX_RETRIES) break;
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      continue;
    }

    if (response.ok) {
      return response.json();
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string };
    };
    const detail = body.error?.message ?? `HTTP ${response.status}`;

    if (!isRetryableStatus(response.status)) {
      if (response.status === 401) {
        throw new ApiError(`Google rejected the access token: ${detail}`, 401, "GOOGLE_INVALID_GRANT");
      }
      if (response.status === 403) {
        throw new ApiError(
          `No permission for this Search Console property: ${detail}`,
          403,
          "GSC_FORBIDDEN"
        );
      }
      throw new ApiError(`Search Console API error: ${detail}`, response.status, "GSC_REQUEST_FAILED");
    }

    lastError = new Error(detail);

    if (attempt === MAX_RETRIES) {
      break;
    }

    // Honour Retry-After when Google sends it, otherwise exponential backoff.
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : BASE_BACKOFF_MS * 2 ** attempt;
    await sleep(delay);
  }

  throw new ApiError(
    `Search Console API unavailable after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? "unknown error"}`,
    503,
    "GSC_UNAVAILABLE"
  );
}

export function propertyTypeOf(siteUrl: string): GscPropertyType {
  return siteUrl.startsWith("sc-domain:") ? "domain" : "url-prefix";
}

/** Every property the connected account can read. */
export async function listSites(options: FetchOptions): Promise<GscSite[]> {
  const payload = (await googleFetch(SITES_ENDPOINT, { method: "GET" }, options)) as {
    siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
  };

  return (payload.siteEntry ?? [])
    .filter((entry) => entry.permissionLevel !== "siteUnverifiedUser")
    .map((entry) => ({
      siteUrl: entry.siteUrl,
      permissionLevel: entry.permissionLevel,
      propertyType: propertyTypeOf(entry.siteUrl)
    }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

function searchAnalyticsUrl(siteUrl: string): string {
  // The property string itself contains characters ("sc-domain:", "://") that
  // must be escaped, or the request 404s against the wrong path.
  return `${SEARCH_ANALYTICS_ENDPOINT}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
}

/** One page of results. Callers usually want queryAllRows instead. */
export async function querySearchAnalytics(
  siteUrl: string,
  query: SearchAnalyticsQuery,
  options: FetchOptions
): Promise<SearchAnalyticsRow[]> {
  const payload = (await googleFetch(
    searchAnalyticsUrl(siteUrl),
    {
      method: "POST",
      body: JSON.stringify({
        startDate: query.startDate,
        endDate: query.endDate,
        dimensions: query.dimensions,
        rowLimit: Math.min(query.rowLimit ?? MAX_ROWS_PER_REQUEST, MAX_ROWS_PER_REQUEST),
        startRow: query.startRow ?? 0,
        type: query.type ?? "web",
        // "all" includes the freshest (still-revising) days. We want them, and
        // mark them provisional rather than pretending they do not exist.
        dataState: query.dataState ?? "all"
      })
    },
    options
  )) as { rows?: SearchAnalyticsRow[] };

  return payload.rows ?? [];
}

/**
 * Page through every row for a query.
 *
 * Stops when a page comes back short of the limit, which is Google's signal
 * that there is nothing further. `maxRows` is a safety valve so a pathological
 * property cannot spin forever.
 */
export async function queryAllRows(
  siteUrl: string,
  query: Omit<SearchAnalyticsQuery, "startRow">,
  options: FetchOptions & { maxRows?: number; onPage?: (count: number, total: number) => void }
): Promise<SearchAnalyticsRow[]> {
  const pageSize = Math.min(query.rowLimit ?? MAX_ROWS_PER_REQUEST, MAX_ROWS_PER_REQUEST);
  const maxRows = options.maxRows ?? 200_000;
  const all: SearchAnalyticsRow[] = [];

  let startRow = 0;

  while (all.length < maxRows) {
    const page = await querySearchAnalytics(
      siteUrl,
      { ...query, rowLimit: pageSize, startRow },
      options
    );

    all.push(...page);
    options.onPage?.(page.length, all.length);

    // A short page means the result set is exhausted.
    if (page.length < pageSize) {
      break;
    }

    startRow += pageSize;
  }

  return all.length > maxRows ? all.slice(0, maxRows) : all;
}
