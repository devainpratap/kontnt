import { describeBudget, hasQuota, nextResetDate, recordUsage, type ProviderBudget } from "./usage-ledger";
import type { SerpFetchResult, SerpProvider, SerpQuery } from "./types";

/**
 * A SerpProvider that composes other providers with failover.
 *
 * Free tiers are small and change without notice, so no single source can be
 * relied on. The chain walks an ordered list and uses the first provider that
 * is both configured and still inside its monthly free allowance.
 *
 * Because this itself implements SerpProvider, nothing upstream changes:
 * RankCheckService, the queue, the routes and the charts are untouched. That is
 * the interface from phase 3b paying off a second time.
 *
 * The distinction that matters, and the reason this is not a simple try/catch
 * loop: **skipping a provider is not a check**. A provider that is out of quota
 * or unconfigured is passed over silently and costs nothing. Only a provider
 * that was actually called can produce a stored outcome, and if every provider
 * is unavailable the result is `blocked` — never a position, never "not found".
 */

export type ChainEntry = {
  provider: SerpProvider;
  /** 0 means no free tier: a paid provider the ledger should not gate. */
  monthlyFree: number;
};

export type ChainAttempt = {
  provider: string;
  outcome: "used" | "skipped-no-quota" | "skipped-unavailable" | "failed";
  reason?: string;
};

export type ChainResult = SerpFetchResult & {
  /** Which provider actually answered, for attribution on the stored check. */
  usedProvider: string | null;
  attempts: ChainAttempt[];
};

export class SerpProviderChain implements SerpProvider {
  readonly name = "chain";

  constructor(private readonly entries: ChainEntry[]) {}

  /** Per-provider free budget, for the settings and keyword pages. */
  budgets(now: Date = new Date()): ProviderBudget[] {
    return this.entries.map((entry) => describeBudget(entry.provider.name, entry.monthlyFree, now));
  }

  async getStatus() {
    const statuses = await Promise.all(this.entries.map((entry) => entry.provider.getStatus()));
    const usable = statuses.filter((status, index) => {
      return status.available && hasQuota(this.entries[index].provider.name, this.entries[index].monthlyFree);
    });

    if (usable.length === 0) {
      const configured = statuses.filter((status) => status.available);
      return {
        name: "chain",
        available: false,
        message:
          configured.length === 0
            ? `No SERP provider is configured. Chain: ${this.entries.map((e) => e.provider.name).join(" → ")}.`
            : `All providers are out of free quota until ${nextResetDate()}.`
      };
    }

    const remaining = this.budgets()
      .filter((budget) => budget.remaining === null || budget.remaining > 0)
      .map((budget) => `${budget.provider}${budget.remaining === null ? "" : ` (${budget.remaining})`}`)
      .join(" → ");

    return {
      name: "chain",
      available: true,
      message: `Failover chain ready: ${remaining}. Free quota resets ${nextResetDate()}.`
    };
  }

  /**
   * Try each provider in order until one answers.
   *
   * `usedProvider` on the result tells the caller which source to attribute the
   * check to, so a keyword's history stays honest about where each reading came
   * from even as the chain shifts between providers.
   */
  async fetchWithAttribution(query: SerpQuery, signal?: AbortSignal): Promise<ChainResult> {
    const attempts: ChainAttempt[] = [];
    let lastFailure: SerpFetchResult | null = null;
    let lastFailureProvider: string | null = null;

    for (const entry of this.entries) {
      if (signal?.aborted) {
        break;
      }

      const providerName = entry.provider.name;

      if (!hasQuota(providerName, entry.monthlyFree)) {
        // Costs nothing and is not a check — just move on.
        attempts.push({ provider: providerName, outcome: "skipped-no-quota" });
        continue;
      }

      const status = await entry.provider.getStatus();
      if (!status.available) {
        attempts.push({ provider: providerName, outcome: "skipped-unavailable", reason: status.message });
        continue;
      }

      // Recorded before the call: a request consumes the allowance whether or
      // not it returns anything usable. Over-counting by one on a crash is far
      // cheaper than silently overrunning a free tier.
      recordUsage(providerName);

      const result = await entry.provider.fetch(query, signal);

      if (result.status === "ok") {
        attempts.push({ provider: providerName, outcome: "used" });
        return { ...result, usedProvider: providerName, attempts };
      }

      attempts.push({
        provider: providerName,
        outcome: "failed",
        reason: result.errorMessage ?? result.status
      });
      lastFailure = result;
      lastFailureProvider = providerName;
    }

    // Something was tried and failed: report that provider's actual reason
    // rather than a generic message, so the operator can act on it.
    if (lastFailure) {
      return { ...lastFailure, usedProvider: lastFailureProvider, attempts };
    }

    // Nothing was callable at all. Explicitly unknown — never a position, and
    // never "not found", which would read as a ranking collapse.
    return {
      status: "blocked",
      results: [],
      features: [],
      raw: { attempts },
      errorMessage: `No SERP provider available (${attempts
        .map((attempt) => `${attempt.provider}: ${attempt.outcome}`)
        .join(", ")}). Free quota resets ${nextResetDate()}.`,
      usedProvider: null,
      attempts
    };
  }

  async fetch(query: SerpQuery, signal?: AbortSignal): Promise<SerpFetchResult> {
    return this.fetchWithAttribution(query, signal);
  }

  async dispose() {
    await Promise.all(this.entries.map((entry) => entry.provider.dispose?.()));
  }
}
