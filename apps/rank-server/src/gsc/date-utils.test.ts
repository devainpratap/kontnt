import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  backfillWindow,
  dateRange,
  daysBetween,
  isProvisional,
  latestLikelyDataDate,
  rollingWindow,
  startOfWeek,
  todayInGscZone
} from "./date-utils";

describe("todayInGscZone", () => {
  it("uses Pacific time, not the machine's local clock", () => {
    // 2026-03-15T04:00Z is still 2026-03-14 in Los Angeles. A sync running
    // from India at this instant must not label the day 03-15, or the rolling
    // re-pull writes the same data under two different date keys.
    assert.equal(todayInGscZone(new Date("2026-03-15T04:00:00Z")), "2026-03-14");
  });

  it("rolls over at Pacific midnight", () => {
    assert.equal(todayInGscZone(new Date("2026-03-15T06:59:00Z")), "2026-03-14");
    assert.equal(todayInGscZone(new Date("2026-03-15T07:01:00Z")), "2026-03-15");
  });

  it("handles the winter offset (UTC-8)", () => {
    assert.equal(todayInGscZone(new Date("2026-01-10T07:59:00Z")), "2026-01-09");
    assert.equal(todayInGscZone(new Date("2026-01-10T08:01:00Z")), "2026-01-10");
  });
});

describe("addDays", () => {
  it("adds and subtracts whole days", () => {
    assert.equal(addDays("2026-07-24", 1), "2026-07-25");
    assert.equal(addDays("2026-07-24", -1), "2026-07-23");
    assert.equal(addDays("2026-07-24", 0), "2026-07-24");
  });

  it("crosses month and year boundaries", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  });

  it("handles leap years", () => {
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  });

  it("is exact across the US spring-forward DST boundary", () => {
    // 2026-03-08 is spring forward in the US. Local-time arithmetic would add
    // 23h here and land back on the same calendar day.
    assert.equal(addDays("2026-03-07", 1), "2026-03-08");
    assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  });

  it("is exact across the US fall-back DST boundary", () => {
    // 2026-11-01 is fall back — a 25h local day.
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-11-01", 1), "2026-11-02");
  });

  it("rejects a malformed date", () => {
    assert.throws(() => addDays("24-07-2026", 1), /YYYY-MM-DD/);
    assert.throws(() => addDays("2026-7-4", 1), /YYYY-MM-DD/);
  });
});

describe("daysBetween", () => {
  it("counts whole days in both directions", () => {
    assert.equal(daysBetween("2026-07-24", "2026-07-31"), 7);
    assert.equal(daysBetween("2026-07-31", "2026-07-24"), -7);
    assert.equal(daysBetween("2026-07-24", "2026-07-24"), 0);
  });

  it("stays exact across DST boundaries", () => {
    // Both spans are 7 calendar days despite one containing a 23h local day
    // and the other a 25h local day.
    assert.equal(daysBetween("2026-03-05", "2026-03-12"), 7);
    assert.equal(daysBetween("2026-10-29", "2026-11-05"), 7);
  });
});

describe("dateRange", () => {
  it("is inclusive of both ends", () => {
    assert.deepEqual(dateRange("2026-07-24", "2026-07-27"), [
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-27"
    ]);
  });

  it("returns a single date when start equals end", () => {
    assert.deepEqual(dateRange("2026-07-24", "2026-07-24"), ["2026-07-24"]);
  });

  it("returns empty when end precedes start", () => {
    assert.deepEqual(dateRange("2026-07-27", "2026-07-24"), []);
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of the containing week", () => {
    // 2026-07-24 is a Friday.
    assert.equal(startOfWeek("2026-07-24"), "2026-07-20");
  });

  it("treats Sunday as the end of the week, not the start", () => {
    // 2026-07-26 is a Sunday and belongs to the week beginning 07-20.
    assert.equal(startOfWeek("2026-07-26"), "2026-07-20");
  });

  it("is idempotent on a Monday", () => {
    assert.equal(startOfWeek("2026-07-20"), "2026-07-20");
  });
});

describe("latestLikelyDataDate", () => {
  it("stays one day behind Pacific today, since today is always empty", () => {
    assert.equal(latestLikelyDataDate(new Date("2026-07-24T20:00:00Z")), "2026-07-23");
  });
});

describe("rollingWindow", () => {
  it("spans exactly windowDays inclusive", () => {
    const window = rollingWindow(5, new Date("2026-07-24T20:00:00Z"));
    assert.equal(window.endDate, "2026-07-23");
    assert.equal(window.startDate, "2026-07-19");
    assert.equal(dateRange(window.startDate, window.endDate).length, 5);
  });

  it("supports a single-day window", () => {
    const window = rollingWindow(1, new Date("2026-07-24T20:00:00Z"));
    assert.equal(window.startDate, window.endDate);
  });

  it("rejects a non-positive window", () => {
    assert.throws(() => rollingWindow(0), /positive integer/);
    assert.throws(() => rollingWindow(-3), /positive integer/);
  });
});

describe("backfillWindow", () => {
  it("reaches back the requested number of months", () => {
    const window = backfillWindow(16, new Date("2026-07-24T20:00:00Z"));
    assert.equal(window.endDate, "2026-07-23");
    assert.equal(window.startDate, "2025-03-23");
  });
});

describe("isProvisional", () => {
  const latest = "2026-07-23";

  it("flags the most recent days that Google is still revising", () => {
    assert.equal(isProvisional("2026-07-23", latest, 3), true);
    assert.equal(isProvisional("2026-07-22", latest, 3), true);
    assert.equal(isProvisional("2026-07-21", latest, 3), true);
  });

  it("treats older days as settled", () => {
    assert.equal(isProvisional("2026-07-20", latest, 3), false);
    assert.equal(isProvisional("2026-01-01", latest, 3), false);
  });

  it("measures from the latest available date, not from now", () => {
    // After a stale sync the newest row may be a week old. Days well before it
    // are settled and must not be re-flagged as provisional.
    assert.equal(isProvisional("2026-07-10", "2026-07-16", 3), false);
    assert.equal(isProvisional("2026-07-15", "2026-07-16", 3), true);
  });

  it("treats a future date as provisional", () => {
    assert.equal(isProvisional("2026-07-25", latest, 3), true);
  });
});
