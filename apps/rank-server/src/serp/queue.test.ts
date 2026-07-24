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
    const progress = await runCheckBatch(keywords, fakeService(["ok", "ok", "not-found"]), { noDelay: true, concurrency: 1 });

    assert.equal(progress.total, 3);
    assert.equal(progress.completed, 3);
    // not-found is a real reading, so it counts as a success, not a failure.
    assert.equal(progress.ok, 3);
    assert.equal(progress.blocked, 0);
    assert.equal(progress.stoppedReason, null);
  });

  it("counts blocked checks separately from real readings", async () => {
    const progress = await runCheckBatch([keyword({ id: "a" }), keyword({ id: "b" })], fakeService(["ok", "blocked"]), { noDelay: true, concurrency: 1 });

    assert.equal(progress.ok, 1);
    assert.equal(progress.blocked, 1);
  });

  it("stops after three consecutive blocks rather than burning the day's budget", async () => {
    const keywords = Array.from({ length: 10 }, (_, index) => keyword({ id: `k${index}` }));
    const progress = await runCheckBatch(keywords, fakeService(["blocked", "blocked", "blocked"]), { noDelay: true, concurrency: 1 });

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
      { noDelay: true, concurrency: 1 }
    );

    assert.equal(progress.completed, 6);
    assert.equal(progress.stoppedReason, null);
  });

  it("stops at the daily cap and says which keywords were skipped", async () => {
    const keywords = Array.from({ length: 10 }, (_, index) => keyword({ id: `k${index}` }));
    const progress = await runCheckBatch(keywords, fakeService(["ok"], 4), { noDelay: true, concurrency: 1 });

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

    const progress = await runCheckBatch(keywords, service, { noDelay: true, concurrency: 1, signal: controller.signal });
    assert.equal(progress.stoppedReason, "Cancelled.");
    assert.ok(progress.completed < 5);
  });

  it("reports progress as it goes", async () => {
    const updates: number[] = [];
    await runCheckBatch([keyword({ id: "a" }), keyword({ id: "b" })], fakeService(["ok", "ok"]), {
      noDelay: true,
      concurrency: 1,
      onProgress: (progress) => updates.push(progress.completed)
    });

    assert.deepEqual(updates, [1, 2]);
  });

  it("handles an empty batch", async () => {
    const progress = await runCheckBatch([], fakeService([]), { noDelay: true, concurrency: 1 });
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

describe("runCheckBatch — concurrent (API) mode", () => {
  it("checks every keyword when run as a pool", async () => {
    const keywords = Array.from({ length: 20 }, (_, index) => keyword({ id: `c${index}` }));
    const progress = await runCheckBatch(keywords, fakeService(Array(20).fill("ok")), {
      noDelay: true,
      concurrency: 5
    });

    assert.equal(progress.completed, 20);
    assert.equal(progress.ok, 20);
    // Every keyword recorded exactly once - no double-claim across workers.
    const ids = new Set(progress.outcomes.map((o) => o.keywordId));
    assert.equal(ids.size, 20);
  });

  it("never runs more workers than keywords", async () => {
    const progress = await runCheckBatch([keyword({ id: "solo" })], fakeService(["ok"]), {
      noDelay: true,
      concurrency: 8
    });
    assert.equal(progress.completed, 1);
  });

  it("stops near the daily cap under concurrency", async () => {
    // Overshoot by less than the worker count is acceptable; the cap is a soft
    // guard, not an exact ceiling.
    const keywords = Array.from({ length: 30 }, (_, index) => keyword({ id: `cap${index}` }));
    const progress = await runCheckBatch(keywords, fakeService(Array(30).fill("ok"), 10), {
      noDelay: true,
      concurrency: 4
    });

    assert.ok(progress.completed >= 10 && progress.completed <= 14, `completed ${progress.completed}`);
    assert.match(progress.stoppedReason ?? "", /daily cap/i);
  });

  it("stops when cancelled mid-pool", async () => {
    const controller = new AbortController();
    const keywords = Array.from({ length: 20 }, (_, index) => keyword({ id: `x${index}` }));

    const service = fakeService(Array(20).fill("ok"));
    const original = service.checkKeyword.bind(service);
    let calls = 0;
    service.checkKeyword = async (target: KeywordRecord) => {
      calls += 1;
      if (calls === 3) controller.abort();
      return original(target);
    };

    const progress = await runCheckBatch(keywords, service, {
      noDelay: true,
      concurrency: 4,
      signal: controller.signal
    });
    assert.equal(progress.stoppedReason, "Cancelled.");
    assert.ok(progress.completed < 20);
  });
});
