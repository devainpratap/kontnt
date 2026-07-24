import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

let ledger: typeof import("./usage-ledger");
let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-ledger-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ ensureRankDirs }, dbClient] = await Promise.all([import("../config"), import("../db/client")]);
  await ensureRankDirs();
  dbClient.initializeRankDatabase();

  ledger = await import("./usage-ledger");
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("currentYearMonth", () => {
  it("formats as YYYY-MM in UTC", () => {
    assert.equal(ledger.currentYearMonth(new Date("2026-07-24T12:00:00Z")), "2026-07");
  });

  it("rolls over at the month boundary", () => {
    assert.equal(ledger.currentYearMonth(new Date("2026-07-31T23:59:59Z")), "2026-07");
    assert.equal(ledger.currentYearMonth(new Date("2026-08-01T00:00:01Z")), "2026-08");
  });
});

describe("nextResetDate", () => {
  it("is the first of the following month", () => {
    assert.equal(ledger.nextResetDate(new Date("2026-07-24T12:00:00Z")), "2026-08-01");
  });

  it("rolls the year over from December", () => {
    assert.equal(ledger.nextResetDate(new Date("2026-12-15T00:00:00Z")), "2027-01-01");
  });
});

describe("recordUsage / getUsed", () => {
  it("starts at zero for an unseen provider", () => {
    assert.equal(ledger.getUsed("fresh-provider", "2026-07"), 0);
  });

  it("increments on each call", () => {
    assert.equal(ledger.recordUsage("alpha", "2026-07"), 1);
    assert.equal(ledger.recordUsage("alpha", "2026-07"), 2);
    assert.equal(ledger.recordUsage("alpha", "2026-07"), 3);
    assert.equal(ledger.getUsed("alpha", "2026-07"), 3);
  });

  it("keeps providers independent", () => {
    ledger.recordUsage("beta", "2026-07");
    assert.equal(ledger.getUsed("beta", "2026-07"), 1);
    assert.equal(ledger.getUsed("alpha", "2026-07"), 3);
  });

  it("resets across a month boundary", () => {
    // The whole point of the free tier: August starts clean.
    assert.equal(ledger.getUsed("alpha", "2026-08"), 0);
    ledger.recordUsage("alpha", "2026-08");
    assert.equal(ledger.getUsed("alpha", "2026-08"), 1);
    assert.equal(ledger.getUsed("alpha", "2026-07"), 3, "July must be unaffected");
  });

  it("supports recording more than one at a time", () => {
    ledger.recordUsage("bulk", "2026-07", 25);
    assert.equal(ledger.getUsed("bulk", "2026-07"), 25);
  });
});

describe("getRemaining / hasQuota", () => {
  it("counts down from the monthly allowance", () => {
    ledger.recordUsage("counted", "2026-09", 10);
    assert.equal(ledger.getRemaining("counted", 250, "2026-09"), 240);
    assert.equal(ledger.hasQuota("counted", 250, "2026-09"), true);
  });

  it("reports exhaustion once the allowance is spent", () => {
    ledger.recordUsage("spent", "2026-09", 250);
    assert.equal(ledger.getRemaining("spent", 250, "2026-09"), 0);
    assert.equal(ledger.hasQuota("spent", 250, "2026-09"), false);
  });

  it("never reports a negative remaining", () => {
    // Over-counting is possible (usage is recorded before the call), and a
    // negative would break the UI and any arithmetic downstream.
    ledger.recordUsage("over", "2026-09", 300);
    assert.equal(ledger.getRemaining("over", 250, "2026-09"), 0);
  });

  it("treats a zero allowance as an unmetered paid provider", () => {
    // DataForSEO has no free tier; the ledger must not block its calls. The
    // provider itself fails if the account is dry.
    assert.equal(ledger.getRemaining("paid", 0, "2026-09"), Number.POSITIVE_INFINITY);
    assert.equal(ledger.hasQuota("paid", 0, "2026-09"), true);
  });
});

describe("describeBudget", () => {
  it("summarises a metered provider", () => {
    ledger.recordUsage("summary", "2026-07", 40);
    const budget = ledger.describeBudget("summary", 5000, new Date("2026-07-24T00:00:00Z"));

    assert.equal(budget.provider, "summary");
    assert.equal(budget.used, 40);
    assert.equal(budget.monthlyFree, 5000);
    assert.equal(budget.remaining, 4960);
    assert.equal(budget.resetsOn, "2026-08-01");
  });

  it("reports null remaining for an unmetered provider", () => {
    // null, not Infinity — Infinity does not survive JSON serialisation to the UI.
    const budget = ledger.describeBudget("unmetered", 0, new Date("2026-07-24T00:00:00Z"));
    assert.equal(budget.remaining, null);
  });
});
