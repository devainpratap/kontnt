import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { SerpFetchResult, SerpProvider, SerpQuery } from "./types";

let SerpProviderChain: typeof import("./provider-chain").SerpProviderChain;
let ledger: typeof import("./usage-ledger");
let workspaceRoot: string;

const QUERY: SerpQuery = { keyword: "gps tracker", country: "in", device: "desktop", location: null };

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-chain-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ ensureRankDirs }, dbClient] = await Promise.all([import("../config"), import("../db/client")]);
  await ensureRankDirs();
  dbClient.initializeRankDatabase();

  ({ SerpProviderChain } = await import("./provider-chain"));
  ledger = await import("./usage-ledger");
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

/** A scriptable stand-in provider that records how often it was called. */
function fakeProvider(
  name: string,
  behaviour: { available?: boolean; result?: SerpFetchResult["status"]; message?: string } = {}
): SerpProvider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    async getStatus() {
      return {
        name,
        available: behaviour.available ?? true,
        message: behaviour.message ?? `${name} ready`
      };
    },
    async fetch(): Promise<SerpFetchResult> {
      provider.calls += 1;
      const status = behaviour.result ?? "ok";
      if (status === "ok") {
        return {
          status: "ok",
          results: [{ position: 1, url: "https://adclear.in/", domain: "adclear.in", title: "AdClear" }],
          features: [],
          raw: { from: name },
          errorMessage: null
        };
      }
      return {
        status,
        results: [],
        features: [],
        raw: { from: name },
        errorMessage: `${name} failed`
      };
    }
  };
  return provider;
}

describe("SerpProviderChain — happy path", () => {
  it("uses the first healthy provider and does not touch the rest", async () => {
    const first = fakeProvider("p-first-a");
    const second = fakeProvider("p-second-a");

    const chain = new SerpProviderChain([
      { provider: first, monthlyFree: 100 },
      { provider: second, monthlyFree: 100 }
    ]);

    const result = await chain.fetchWithAttribution(QUERY);

    assert.equal(result.status, "ok");
    assert.equal(result.usedProvider, "p-first-a");
    assert.equal(first.calls, 1);
    assert.equal(second.calls, 0, "the fallback must not be called when the primary answers");
  });

  it("records usage against the provider that was called", async () => {
    const provider = fakeProvider("p-usage-a");
    const chain = new SerpProviderChain([{ provider, monthlyFree: 100 }]);

    const before = ledger.getUsed("p-usage-a");
    await chain.fetchWithAttribution(QUERY);
    assert.equal(ledger.getUsed("p-usage-a"), before + 1);
  });
});

describe("SerpProviderChain — failover", () => {
  it("falls through to the next provider when the first fails", async () => {
    const failing = fakeProvider("p-fail-b", { result: "error" });
    const working = fakeProvider("p-work-b");

    const chain = new SerpProviderChain([
      { provider: failing, monthlyFree: 100 },
      { provider: working, monthlyFree: 100 }
    ]);

    const result = await chain.fetchWithAttribution(QUERY);

    assert.equal(result.status, "ok");
    assert.equal(result.usedProvider, "p-work-b");
    assert.equal(failing.calls, 1);
    assert.equal(working.calls, 1);
  });

  it("charges quota to a provider that was called and failed", async () => {
    // A request is spent whether or not it returned anything usable. Counting
    // only successes would keep calling an exhausted provider forever.
    const failing = fakeProvider("p-charge-b", { result: "blocked" });
    const working = fakeProvider("p-ok-b");

    const chain = new SerpProviderChain([
      { provider: failing, monthlyFree: 100 },
      { provider: working, monthlyFree: 100 }
    ]);

    await chain.fetchWithAttribution(QUERY);
    assert.equal(ledger.getUsed("p-charge-b"), 1);
  });

  it("skips an exhausted provider without calling or charging it", async () => {
    const exhausted = fakeProvider("p-exhausted-b");
    const backup = fakeProvider("p-backup-b");

    ledger.recordUsage("p-exhausted-b", ledger.currentYearMonth(), 5);

    const chain = new SerpProviderChain([
      { provider: exhausted, monthlyFree: 5 },
      { provider: backup, monthlyFree: 100 }
    ]);

    const result = await chain.fetchWithAttribution(QUERY);

    assert.equal(result.usedProvider, "p-backup-b");
    assert.equal(exhausted.calls, 0, "an out-of-quota provider must never be called");
    assert.equal(ledger.getUsed("p-exhausted-b"), 5, "and must not be charged");
    assert.ok(result.attempts.some((a) => a.provider === "p-exhausted-b" && a.outcome === "skipped-no-quota"));
  });

  it("skips an unconfigured provider without charging it", async () => {
    const unconfigured = fakeProvider("p-unconfig-b", { available: false, message: "No API key" });
    const backup = fakeProvider("p-backup2-b");

    const chain = new SerpProviderChain([
      { provider: unconfigured, monthlyFree: 100 },
      { provider: backup, monthlyFree: 100 }
    ]);

    const result = await chain.fetchWithAttribution(QUERY);

    assert.equal(result.usedProvider, "p-backup2-b");
    assert.equal(unconfigured.calls, 0);
    assert.equal(ledger.getUsed("p-unconfig-b"), 0);
  });

  it("treats a paid provider (no free tier) as always having quota", async () => {
    // monthlyFree 0 means "billed per request" — the ledger must not gate it.
    const paid = fakeProvider("p-paid-b");
    ledger.recordUsage("p-paid-b", ledger.currentYearMonth(), 9999);

    const chain = new SerpProviderChain([{ provider: paid, monthlyFree: 0 }]);
    const result = await chain.fetchWithAttribution(QUERY);

    assert.equal(result.status, "ok");
    assert.equal(paid.calls, 1);
  });
});

describe("SerpProviderChain — nothing available", () => {
  it("returns blocked, never a position, when every provider is exhausted", async () => {
    // The single most important behaviour here. If this produced "not-found"
    // the dashboard would report an exhausted free tier as a ranking collapse.
    const a = fakeProvider("p-none-c1");
    const b = fakeProvider("p-none-c2");

    ledger.recordUsage("p-none-c1", ledger.currentYearMonth(), 10);
    ledger.recordUsage("p-none-c2", ledger.currentYearMonth(), 10);

    const chain = new SerpProviderChain([
      { provider: a, monthlyFree: 10 },
      { provider: b, monthlyFree: 10 }
    ]);

    const result = await chain.fetchWithAttribution(QUERY);

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.results, []);
    assert.equal(result.usedProvider, null);
    assert.equal(a.calls, 0);
    assert.equal(b.calls, 0);
    assert.match(result.errorMessage ?? "", /no serp provider available/i);
    assert.match(result.errorMessage ?? "", /resets/i);
  });

  it("reports the last real failure rather than a generic message", async () => {
    // If something was actually tried, the operator needs that reason, not
    // "nothing available".
    const failing = fakeProvider("p-lastfail-c", { result: "blocked" });
    const chain = new SerpProviderChain([{ provider: failing, monthlyFree: 100 }]);

    const result = await chain.fetchWithAttribution(QUERY);

    assert.equal(result.status, "blocked");
    assert.equal(result.usedProvider, "p-lastfail-c");
    assert.match(result.errorMessage ?? "", /p-lastfail-c failed/);
  });

  it("handles an empty chain", async () => {
    const chain = new SerpProviderChain([]);
    const result = await chain.fetchWithAttribution(QUERY);
    assert.equal(result.status, "blocked");
    assert.equal(result.usedProvider, null);
  });
});

describe("SerpProviderChain — status and budgets", () => {
  it("reports unavailable when nothing is configured", async () => {
    const chain = new SerpProviderChain([
      { provider: fakeProvider("p-nc-d", { available: false }), monthlyFree: 100 }
    ]);

    const status = await chain.getStatus();
    assert.equal(status.available, false);
    assert.match(status.message, /no serp provider is configured/i);
  });

  it("reports unavailable, with a reset date, when all quotas are spent", async () => {
    ledger.recordUsage("p-spent-d", ledger.currentYearMonth(), 10);
    const chain = new SerpProviderChain([
      { provider: fakeProvider("p-spent-d"), monthlyFree: 10 }
    ]);

    const status = await chain.getStatus();
    assert.equal(status.available, false);
    assert.match(status.message, /out of free quota until \d{4}-\d{2}-\d{2}/i);
  });

  it("lists remaining budget per provider when healthy", async () => {
    const chain = new SerpProviderChain([
      { provider: fakeProvider("p-budget-d1"), monthlyFree: 5000 },
      { provider: fakeProvider("p-budget-d2"), monthlyFree: 250 }
    ]);

    const status = await chain.getStatus();
    assert.equal(status.available, true);

    const budgets = chain.budgets();
    assert.equal(budgets.length, 2);
    assert.equal(budgets[0].monthlyFree, 5000);
    assert.equal(budgets[1].remaining, 250);
  });
});
