import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { median, resolveConsensus, type Reading } from "./consensus";

function ok(position: number, source = "scrapingrobot"): Reading {
  return { status: "ok", position, source };
}
const notFound: Reading = { status: "not-found", position: null };
const blocked: Reading = { status: "blocked", position: null };
const errored: Reading = { status: "error", position: null };

describe("median", () => {
  it("returns the middle value for odd-length lists", () => {
    assert.equal(median([10, 6, 10]), 10);
    assert.equal(median([3]), 3);
  });

  it("averages the two middle values for even-length lists", () => {
    assert.equal(median([6, 10]), 8);
    assert.equal(median([2, 4, 6, 8]), 5);
  });

  it("is order-independent", () => {
    assert.equal(median([10, 6, 10]), median([6, 10, 10]));
  });
});

describe("resolveConsensus — the proxy-noise case", () => {
  it("resolves the measured 10/6/10 wobble to the majority position", () => {
    // This is the exact live observation the feature exists for. A single
    // reading could have stored 6 and later 10, inventing a four-place 'drop'.
    const result = resolveConsensus([ok(10), ok(6), ok(10)]);
    assert.equal(result.status, "ok");
    assert.equal(result.position, 10);
    assert.equal(result.agreement.spread, 4);
  });

  it("takes the median of three distinct readings", () => {
    const result = resolveConsensus([ok(8), ok(12), ok(9)]);
    assert.equal(result.position, 9);
  });

  it("reports spread so a low-confidence reading is visible", () => {
    const result = resolveConsensus([ok(6), ok(45)]);
    // Two readings, both ok, wildly apart. Still resolved (median 25.5) but the
    // spread flags it as untrustworthy.
    assert.equal(result.status, "ok");
    assert.equal(result.agreement.spread, 39);
  });
});

describe("resolveConsensus — unanimity", () => {
  it("passes through a unanimous position", () => {
    const result = resolveConsensus([ok(9), ok(9), ok(9)]);
    assert.equal(result.status, "ok");
    assert.equal(result.position, 9);
    assert.equal(result.agreement.spread, 0);
  });

  it("handles a single reading (consensus disabled)", () => {
    const result = resolveConsensus([ok(5)]);
    assert.equal(result.status, "ok");
    assert.equal(result.position, 5);
  });

  it("passes through a unanimous not-found", () => {
    const result = resolveConsensus([notFound, notFound, notFound]);
    assert.equal(result.status, "not-found");
    assert.equal(result.position, null);
  });
});

describe("resolveConsensus — majority rules", () => {
  it("stores the position when ok readings outnumber not-found", () => {
    const result = resolveConsensus([ok(7), ok(7), notFound]);
    assert.equal(result.status, "ok");
    assert.equal(result.position, 7);
  });

  it("stores not-found when it outnumbers ok readings", () => {
    const result = resolveConsensus([notFound, notFound, ok(30)]);
    assert.equal(result.status, "not-found");
    assert.equal(result.position, null);
  });

  it("computes the median only over the ok readings, ignoring not-found", () => {
    const result = resolveConsensus([ok(4), ok(8), ok(20), notFound]);
    // Median of [4,8,20] = 8; the not-found does not shift it.
    assert.equal(result.position, 8);
  });
});

describe("resolveConsensus — disagreement is unknown, never a guess", () => {
  it("returns blocked on a dead tie between ok and not-found", () => {
    // One call ranks the client, one does not. That is not a position to
    // average - it is genuine uncertainty, and must be recorded as unknown.
    const result = resolveConsensus([ok(9), notFound]);
    assert.equal(result.status, "blocked");
    assert.equal(result.position, null);
  });

  it("returns blocked when every attempt was blocked or errored", () => {
    const result = resolveConsensus([blocked, errored, blocked]);
    assert.equal(result.status, "blocked");
    assert.equal(result.position, null);
    assert.equal(result.agreement.realReadings, 0);
  });

  it("ignores blocked/error readings when a majority still observed the SERP", () => {
    // Non-readings do not get a vote: two real observations of position 5
    // outweigh a blocked attempt entirely.
    const result = resolveConsensus([ok(5), ok(5), blocked]);
    assert.equal(result.status, "ok");
    assert.equal(result.position, 5);
    assert.equal(result.agreement.unknownCount, 1);
  });

  it("handles an empty set", () => {
    const result = resolveConsensus([]);
    assert.equal(result.status, "blocked");
    assert.equal(result.agreement.attempts, 0);
  });
});

describe("resolveConsensus — attribution", () => {
  it("attributes the result to the source nearest the agreed position", () => {
    const result = resolveConsensus([ok(10, "scrapingrobot"), ok(6, "serpapi"), ok(10, "scrapingrobot")]);
    // Agreed position is 10; the winning source is the one that read 10.
    assert.equal(result.position, 10);
    assert.equal(result.source, "scrapingrobot");
  });

  it("carries no source for a not-found consensus", () => {
    const result = resolveConsensus([notFound, notFound]);
    assert.equal(result.source, null);
  });
});
