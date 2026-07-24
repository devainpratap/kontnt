import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeywordRecord } from "@rankos/shared";

import { runCheckBatch, selectDueKeywords } from "./queue";
import type { CheckOutcome, RankCheckService } from "./rank-check-service";

function keyword(overrides: Partial<KeywordRecord> = {}): KeywordRecord {
  return {
    id: overrides.id ?? "k1",
    clientId: "c1",
    phrase: overrides.phrase ?? "gps tracker",
    country: "in",
    device: "desktop",
    location: null,
    targetUrl: null,
    tags: [],
    cadence: "weekly",
    isActive: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

/** A stand-in service that returns scripted outcomes without touching a browser. */
function fakeService(script: Array<CheckOutcome["status"]>, remaining = 999): RankCheckService {
  let index = 0;
  let used = 0;

  return {
    async checkKeyword(target: KeywordRecord) {
      const status = script[index] ?? "ok";
      index += 1;
      used += 1;
      return {
        keywordId: target.id,
        phrase: target.phrase,
        status,
        position: status === "ok" ? 5 : null,
        previousPosition: null,
        rankingUrl: status === "ok" ? "https://adclear.in/" : null,
        errorMessage: status === "blocked" ? "Google interstitial detected." : null
      } satisfies CheckOutcome;
    },
    remainingToday() {
      return Math.max(0, remaining - used);
    }
  } as unknown as RankCheckService;
}

describe("runCheckBatch", () => {
  it("checks every keyword and tallies outcomes", async () => {
    const keywords = [keyword({ id: "a" }), keyword({ id: "b" }), keyword({ id: "c" })];
    const progress = await runCheckBatch(keywords, fakeService(["ok", "ok", "not-found"]), { noDelay: true });

    assert.equal(progress.total, 3);
    assert.equal(progress.completed, 3);
    // not-found is a real reading, so it counts as a success, not a failure.
    assert.equal(progress.ok, 3);
    assert.equal(progress.blocked, 0);
    assert.equal(progress.stoppedReason, null);
  });

  it("counts blocked checks separately from real readings", async () => {
    const progress = await runCheckBatch([keyword({ id: "a" }), keyword({ id: "b" })], fakeService(["ok", "blocked"]), {
      noDelay: true
    });

    assert.equal(progress.ok, 1);
    assert.equal(progress.blocked, 1);
  });

  it("stops after three consecutive blocks rather than burning the day's budget", async () => {
    const keywords = Array.from({ length: 10 }, (_, index) => keyword({ id: `k${index}` }));
    const progress = await runCheckBatch(keywords, fakeService(["blocked", "blocked", "blocked"]), {
      noDelay: true
    });

    assert.equal(progress.completed, 3);
    assert.match(progress.stoppedReason ?? "", /consecutive blocked/i);
    assert.match(progress.stoppedReason ?? "", /paid source/i);
  });

  it("does not stop when blocks are interspersed with successes", async () => {
    // Occasional blocks are normal; only a sustained run means real trouble.
    const keywords = Array.from({ length: 6 }, (_, index) => keyword({ id: `k${index}` }));
    const progress = await runCheckBatch(
      keywords,
      fakeService(["blocked", "ok", "blocked", "ok", "blocked", "ok"]),
      { noDelay: true }
    );

    assert.equal(progress.completed, 6);
    assert.equal(progress.stoppedReason, null);
  });

  it("stops at the daily cap and says which keywords were skipped", async () => {
    const keywords = Array.from({ length: 10 }, (_, index) => keyword({ id: `k${index}` }));
    const progress = await runCheckBatch(keywords, fakeService(["ok"], 4), { noDelay: true });

    assert.equal(progress.completed, 4);
    assert.match(progress.stoppedReason ?? "", /daily cap/i);
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    const keywords = Array.from({ length: 5 }, (_, index) => keyword({ id: `k${index}` }));

    const service = fakeService(["ok"]);
    const original = service.checkKeyword.bind(service);
    let calls = 0;
    service.checkKeyword = async (target: KeywordRecord) => {
      calls += 1;
      if (calls === 2) {
        controller.abort();
      }
      return original(target);
    };

    const progress = await runCheckBatch(keywords, service, { noDelay: true, signal: controller.signal });
    assert.equal(progress.stoppedReason, "Cancelled.");
    assert.ok(progress.completed < 5);
  });

  it("reports progress as it goes", async () => {
    const updates: number[] = [];
    await runCheckBatch([keyword({ id: "a" }), keyword({ id: "b" })], fakeService(["ok", "ok"]), {
      noDelay: true,
      onProgress: (progress) => updates.push(progress.completed)
    });

    assert.deepEqual(updates, [1, 2]);
  });

  it("handles an empty batch", async () => {
    const progress = await runCheckBatch([], fakeService([]), { noDelay: true });
    assert.equal(progress.total, 0);
    assert.equal(progress.completed, 0);
  });
});

describe("selectDueKeywords", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  it("includes a keyword that has never been checked", () => {
    const due = selectDueKeywords([{ ...keyword(), lastCheckedAt: null }], now);
    assert.equal(due.length, 1);
  });

  it("excludes a paused keyword even if never checked", () => {
    const due = selectDueKeywords([{ ...keyword({ cadence: "paused" }), lastCheckedAt: null }], now);
    assert.equal(due.length, 0);
  });

  it("excludes an inactive keyword", () => {
    const due = selectDueKeywords([{ ...keyword({ isActive: false }), lastCheckedAt: null }], now);
    assert.equal(due.length, 0);
  });

  it("treats a daily keyword as due after 20 hours", () => {
    const notYet = selectDueKeywords(
      [{ ...keyword({ cadence: "daily" }), lastCheckedAt: "2026-07-24T00:00:00Z" }],
      now
    );
    assert.equal(notYet.length, 0);

    const due = selectDueKeywords(
      [{ ...keyword({ cadence: "daily" }), lastCheckedAt: "2026-07-23T10:00:00Z" }],
      now
    );
    assert.equal(due.length, 1);
  });

  it("treats a weekly keyword as due after about six and a half days", () => {
    const notYet = selectDueKeywords(
      [{ ...keyword({ cadence: "weekly" }), lastCheckedAt: "2026-07-20T12:00:00Z" }],
      now
    );
    assert.equal(notYet.length, 0);

    const due = selectDueKeywords(
      [{ ...keyword({ cadence: "weekly" }), lastCheckedAt: "2026-07-17T12:00:00Z" }],
      now
    );
    assert.equal(due.length, 1);
  });
});
