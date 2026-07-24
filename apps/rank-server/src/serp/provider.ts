import { rankConfig } from "../config";
import { dataForSeoProvider, serperProvider } from "./api-drivers";
import { localSerpProvider } from "./local-driver";
import { SerpProviderChain, type ChainEntry } from "./provider-chain";
import { scrapingRobotProvider } from "./scrapingrobot-driver";
import { serpApiProvider } from "./serpapi-driver";
import type { SerpProvider } from "./types";

/**
 * The rank source is pluggable, selected by SERP_PROVIDER in .env.
 *
 * Nothing outside this folder may call a driver directly — the rest of the app
 * talks to `serpProvider` only, which is what makes switching sources a config
 * change rather than a refactor.
 *
 *   chain         (default) failover across SERP_PROVIDER_CHAIN, respecting each
 *                 provider's free monthly allowance.
 *   scrapingrobot 5,000 free scrapes/month, recurring. The primary.
 *   serpapi       250 free searches/month, recurring. The overflow.
 *   dataforseo    $0.0006 per SERP after a $50 minimum deposit. The paid floor.
 *   serper        2,500 one-time free credits.
 *   local         the operator's own Chrome. Free but Google-throttled — kept
 *                 as an opt-in escape hatch, no longer the default.
 */
const singleProviders: Record<string, SerpProvider> = {
  local: localSerpProvider,
  scrapingrobot: scrapingRobotProvider,
  serpapi: serpApiProvider,
  dataforseo: dataForSeoProvider,
  serper: serperProvider
};

function buildChain(): SerpProviderChain {
  const entries: ChainEntry[] = rankConfig.serpProviderChain
    .map((name) => {
      const provider = singleProviders[name];
      if (!provider) {
        console.warn(`[rankos] Unknown SERP provider "${name}" in SERP_PROVIDER_CHAIN — ignoring.`);
        return null;
      }
      return { provider, monthlyFree: rankConfig.monthlyFree[name] ?? 0 };
    })
    .filter((entry): entry is ChainEntry => entry !== null);

  return new SerpProviderChain(entries);
}

export const serpProvider: SerpProvider =
  rankConfig.serpProvider === "chain" ? buildChain() : singleProviders[rankConfig.serpProvider];

/** The chain instance, when one is active — used to report per-provider budgets. */
export const activeChain: SerpProviderChain | null =
  serpProvider instanceof SerpProviderChain ? serpProvider : null;

export function getSerpProviderName(): string {
  return serpProvider.name;
}

/**
 * How long to wait between checks for the active provider.
 *
 * The 25-70s spacing exists solely because Google challenges the browser
 * driver. API providers have no such constraint, so a batch through them runs
 * in minutes rather than hours.
 */
export function interCheckDelayMs(): { min: number; max: number } {
  if (rankConfig.serpProvider === "local") {
    return { min: rankConfig.serpMinDelayMs, max: rankConfig.serpMaxDelayMs };
  }
  return { min: rankConfig.serpApiDelayMs, max: rankConfig.serpApiDelayMs * 2 };
}

/**
 * How many checks may run at once.
 *
 * The local browser must stay serial (1) or Google blocks it; API providers
 * run as a pool. This is the single biggest lever on how long a batch takes.
 */
export function checkConcurrency(): number {
  return rankConfig.serpProvider === "local" ? 1 : rankConfig.serpConcurrency;
}

/** Rough fetch time per keyword, for an honest batch-duration estimate. */
const PER_FETCH_ESTIMATE_MS = rankConfig.serpProvider === "local" ? 9000 : 4000;

/**
 * Honest estimate of how long a batch of `count` keywords will take, using the
 * active provider's real pacing and concurrency - not the browser throttle.
 */
export function estimateBatchMinutes(count: number): number {
  const { min, max } = interCheckDelayMs();
  const perKeyword = (min + max) / 2 + PER_FETCH_ESTIMATE_MS;
  const waves = Math.ceil(count / checkConcurrency());
  return Math.max(1, Math.ceil((waves * perKeyword) / 60_000));
}
