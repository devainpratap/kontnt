import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "../db/client";
import { providerUsageTable } from "../db/schema";

/**
 * Monthly quota accounting for SERP providers.
 *
 * Free tiers are counted in requests, and a request is spent whether or not it
 * comes back usable. That is why usage is tracked here rather than derived from
 * `rank_checks`: a blocked or errored call still consumed the allowance, and a
 * chain that only counted successes would keep calling an exhausted provider
 * and treat every 402 as a ranking failure.
 *
 * Increment happens *before* the call, so a crash mid-request over-counts by at
 * most one. Over-counting costs a spare request; under-counting would silently
 * exceed a free tier and start charging.
 */

/** Calendar month key, in UTC. Free allowances reset on month boundaries. */
export function currentYearMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** First day of the following month — shown in the UI as the reset date. */
export function nextResetDate(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
}

export function getUsed(provider: string, yearMonth = currentYearMonth()): number {
  const row = db
    .select({ used: providerUsageTable.used })
    .from(providerUsageTable)
    .where(and(eq(providerUsageTable.provider, provider), eq(providerUsageTable.yearMonth, yearMonth)))
    .get();

  return row?.used ?? 0;
}

/**
 * Record one consumed request and return the new total.
 *
 * Upserts so the first call of a month creates the row; concurrent callers are
 * safe because the increment happens inside the statement rather than as a
 * read-modify-write.
 */
export function recordUsage(provider: string, yearMonth = currentYearMonth(), count = 1): number {
  db.insert(providerUsageTable)
    .values({
      id: randomUUID(),
      provider,
      yearMonth,
      used: count,
      updatedAt: new Date().toISOString()
    })
    .onConflictDoUpdate({
      target: [providerUsageTable.provider, providerUsageTable.yearMonth],
      set: {
        used: sql`${providerUsageTable.used} + ${count}`,
        updatedAt: new Date().toISOString()
      }
    })
    .run();

  return getUsed(provider, yearMonth);
}

/**
 * Remaining free allowance.
 *
 * A `monthlyFree` of 0 means "no free tier" (a paid provider), which is treated
 * as unlimited here — the chain relies on the provider itself to fail if the
 * account runs dry, rather than this ledger blocking a paid call.
 */
export function getRemaining(provider: string, monthlyFree: number, yearMonth = currentYearMonth()): number {
  if (monthlyFree <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, monthlyFree - getUsed(provider, yearMonth));
}

export function hasQuota(provider: string, monthlyFree: number, yearMonth = currentYearMonth()): boolean {
  return getRemaining(provider, monthlyFree, yearMonth) > 0;
}

export type ProviderBudget = {
  provider: string;
  used: number;
  monthlyFree: number;
  /** `null` when the provider has no free tier and is billed per request. */
  remaining: number | null;
  resetsOn: string;
};

export function describeBudget(provider: string, monthlyFree: number, now: Date = new Date()): ProviderBudget {
  const yearMonth = currentYearMonth(now);
  const remaining = getRemaining(provider, monthlyFree, yearMonth);

  return {
    provider,
    used: getUsed(provider, yearMonth),
    monthlyFree,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetsOn: nextResetDate(now)
  };
}
