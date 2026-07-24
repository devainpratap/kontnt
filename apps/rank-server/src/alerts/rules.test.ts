import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ALERT_THRESHOLDS,
  describeAlert,
  evaluateNewCompetitors,
  evaluateTransition,
  toReading,
  type Reading
} from "./rules";

const ranked = (position: number): Reading => ({ kind: "ranked", position });
const notFound: Reading = { kind: "not-found" };
const unknown: Reading = { kind: "unknown" };

function kinds(previous: Reading, current: Reading) {
  return evaluateTransition(previous, current).map((p) => p.kind).sort();
}

describe("toReading", () => {
  it("maps ok+position to a ranked reading", () => {
    assert.deepEqual(toReading("ok", 5), { kind: "ranked", position: 5 });
  });
  it("maps not-found to a real not-found reading", () => {
    assert.deepEqual(toReading("not-found", null), { kind: "not-found" });
  });
  it("maps blocked and error to unknown", () => {
    assert.deepEqual(toReading("blocked", null), { kind: "unknown" });
    assert.deepEqual(toReading("error", null), { kind: "unknown" });
  });
});

describe("evaluateTransition — the unknown guard", () => {
  it("raises nothing when the current reading is unknown", () => {
    // The rule the whole feature depends on: a scraper hiccup must never fire
    // an alert. "position 4 to unknown" is an absence of data, not a drop.
    assert.deepEqual(evaluateTransition(ranked(4), unknown), []);
  });

  it("raises nothing when the previous reading is unknown", () => {
    assert.deepEqual(evaluateTransition(unknown, ranked(15)), []);
  });

  it("raises nothing when both are unknown", () => {
    assert.deepEqual(evaluateTransition(unknown, unknown), []);
  });
});

describe("evaluateTransition — top 3", () => {
  it("fires entered-top-3 when climbing into the top 3", () => {
    assert.deepEqual(kinds(ranked(7), ranked(2)), ["entered-top-3", "large-move"]);
  });

  it("fires dropped-out-of-top-3 when falling out but still ranked", () => {
    assert.ok(kinds(ranked(2), ranked(6)).includes("dropped-out-of-top-3"));
  });

  it("does not fire entered-top-3 when already in it", () => {
    assert.deepEqual(evaluateTransition(ranked(2), ranked(1)), []);
  });
});

describe("evaluateTransition — page one", () => {
  it("fires dropped-out-of-top-10 when falling off page one", () => {
    assert.ok(kinds(ranked(8), ranked(14)).includes("dropped-out-of-top-10"));
  });

  it("fires dropped-out-of-top-10 when a ranked keyword becomes not-found", () => {
    // Was 8, now not in the top 100 at all - the most important drop to catch.
    const result = evaluateTransition(ranked(8), notFound);
    assert.ok(result.some((p) => p.kind === "dropped-out-of-top-10"));
    assert.ok(result.find((p) => p.kind === "dropped-out-of-top-10")?.payload.currentNotFound);
  });

  it("fires nothing for a small improvement within page one", () => {
    // 9 -> 6 is a 3-place gain: no drop, and below the large-move threshold.
    assert.deepEqual(evaluateTransition(ranked(9), ranked(6)), []);
  });
});

describe("evaluateTransition — large move", () => {
  it("fires on a jump of the threshold or more", () => {
    assert.ok(kinds(ranked(20), ranked(9)).includes("large-move"));
  });

  it("does not fire on a small wobble", () => {
    // 12 -> 14 is 2 places, below the default threshold of 5.
    assert.deepEqual(evaluateTransition(ranked(12), ranked(14)), []);
  });

  it("respects a custom threshold", () => {
    // 15 -> 18 crosses no boundary, so only large-move is in play.
    const result = evaluateTransition(ranked(15), ranked(18), { largeMove: 2 });
    assert.ok(result.some((p) => p.kind === "large-move"));
  });

  it("does not double-fire large-move alongside a more specific drop", () => {
    // 2 -> 15 is both a top-3 drop, a top-10 drop, and a big move. The drops
    // describe it; large-move is suppressed so the operator gets one story.
    const result = kinds(ranked(2), ranked(15));
    assert.ok(result.includes("dropped-out-of-top-3"));
    assert.ok(result.includes("dropped-out-of-top-10"));
    assert.ok(!result.includes("large-move"));
  });

  it("still fires large-move for a big improvement into the top 3", () => {
    // Improvements are worth both the entered-top-3 win and the magnitude.
    const result = kinds(ranked(9), ranked(2));
    assert.ok(result.includes("entered-top-3"));
    assert.ok(result.includes("large-move"));
  });
});

describe("evaluateTransition — delta sign", () => {
  it("reports a negative delta for an improvement", () => {
    const move = evaluateTransition(ranked(9), ranked(2)).find((p) => p.kind === "large-move");
    assert.ok(move && move.delta !== null && move.delta < 0);
  });

  it("reports a positive delta for a decline", () => {
    // 15 -> 24: both off page one already, so large-move is the alert and its
    // delta carries the sign.
    const move = evaluateTransition(ranked(15), ranked(24)).find((p) => p.kind === "large-move");
    assert.ok(move && move.delta !== null && move.delta > 0);
  });
});

describe("evaluateNewCompetitors", () => {
  it("flags a domain newly in the top 3", () => {
    const result = evaluateNewCompetitors(
      ["a.com", "b.com", "adclear.in"],
      ["a.com", "newrival.com", "adclear.in"],
      "adclear.in"
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].payload.competitor, "newrival.com");
  });

  it("never flags the client's own domain", () => {
    const result = evaluateNewCompetitors(["a.com", "b.com"], ["adclear.in", "a.com"], "adclear.in");
    assert.deepEqual(result, []);
  });

  it("says nothing when the top 3 is unchanged", () => {
    assert.deepEqual(evaluateNewCompetitors(["a.com", "b.com"], ["b.com", "a.com"], "x.com"), []);
  });

  it("is case-insensitive", () => {
    assert.deepEqual(evaluateNewCompetitors(["A.com"], ["a.COM"], "x.com"), []);
  });
});

describe("describeAlert", () => {
  it("describes a drop off page one with the not-found nuance", () => {
    const text = describeAlert("dropped-out-of-top-10", { currentNotFound: true }, "gps tracker");
    assert.match(text, /dropped off page one/i);
    assert.match(text, /top 100/i);
  });

  it("names the competitor for a competitor alert", () => {
    assert.match(describeAlert("new-competitor-top-3", { competitor: "rival.com" }), /rival\.com/);
  });

  it("includes the position move when available", () => {
    assert.match(describeAlert("entered-top-3", { previousPosition: 7, currentPosition: 2 }, "x"), /7 to 2/);
  });
});
