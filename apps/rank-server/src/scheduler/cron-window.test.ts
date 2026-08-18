import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mostRecentScheduledFire } from "./cron-window";

/** Read an instant's wall-clock in Asia/Kolkata (fixed UTC+5:30). */
function kolkata(date: Date): { minute: number; hour: number; dayOfWeek: number } {
  const shifted = new Date(date.getTime() + 330 * 60_000);
  return { minute: shifted.getUTCMinutes(), hour: shifted.getUTCHours(), dayOfWeek: shifted.getUTCDay() };
}

describe("mostRecentScheduledFire", () => {
  it("returns today's fire for a daily cron whose time has already passed", () => {
    // 05:30 Kolkata == 00:00 UTC. now is 10:00 UTC (15:30 Kolkata), well after.
    const now = new Date("2026-07-24T10:00:00Z");
    const fire = mostRecentScheduledFire("30 5 * * *", now);
    assert.equal(fire?.toISOString(), "2026-07-24T00:00:00.000Z");
  });

  it("returns yesterday's fire for a daily cron whose time is still ahead today", () => {
    // 16:30 Kolkata == 11:00 UTC, which is after now (10:00 UTC), so the most
    // recent fire is the day before.
    const now = new Date("2026-07-24T10:00:00Z");
    const fire = mostRecentScheduledFire("30 16 * * *", now);
    assert.equal(fire?.toISOString(), "2026-07-23T11:00:00.000Z");
  });

  it("returns the most recent past hour for an hourly cron", () => {
    // :15 Kolkata == :45 UTC of the prior hour. now 10:00 UTC -> 09:45 UTC.
    const now = new Date("2026-07-24T10:00:00Z");
    const fire = mostRecentScheduledFire("15 * * * *", now);
    assert.equal(fire?.toISOString(), "2026-07-24T09:45:00.000Z");
  });

  it("returns now (truncated to the minute) when now is exactly on a fire", () => {
    // 06:00 Kolkata == 00:30 UTC.
    const now = new Date("2026-07-24T00:30:20Z");
    const fire = mostRecentScheduledFire("0 6 * * *", now);
    assert.equal(fire?.toISOString(), "2026-07-24T00:30:00.000Z");
  });

  it("finds the most recent matching weekday for a weekly cron", () => {
    // Monday 08:00 Kolkata. now is a Friday afternoon; the fire must be the
    // Monday of this week, in the past, at 08:00 Kolkata.
    const now = new Date("2026-07-24T10:00:00Z"); // Fri 2026-07-24, 15:30 Kolkata
    const fire = mostRecentScheduledFire("0 8 * * 1", now);
    assert.ok(fire, "expected a fire");
    const wall = kolkata(fire as Date);
    assert.equal(wall.dayOfWeek, 1, "must land on Monday");
    assert.equal(wall.hour, 8);
    assert.equal(wall.minute, 0);
    assert.ok((fire as Date).getTime() <= now.getTime(), "must be at or before now");
    assert.ok(now.getTime() - (fire as Date).getTime() <= 7 * 24 * 60 * 60_000, "within a week");
  });

  it("does not return a fire in the future", () => {
    // now is Monday 07:00 Kolkata (01:30 UTC); this week's 08:00 Monday fire is
    // still ahead, so the answer is last Monday.
    const now = new Date("2026-07-20T01:30:00Z"); // Mon 2026-07-20, 07:00 Kolkata
    const fire = mostRecentScheduledFire("0 8 * * 1", now);
    assert.ok(fire && fire.getTime() < now.getTime());
    assert.equal(kolkata(fire as Date).dayOfWeek, 1);
    assert.ok(now.getTime() - (fire as Date).getTime() >= 6 * 24 * 60 * 60_000, "should be the prior Monday");
  });

  it("returns null for an unparseable expression", () => {
    assert.equal(mostRecentScheduledFire("not a cron", new Date("2026-07-24T10:00:00Z")), null);
    assert.equal(mostRecentScheduledFire("", new Date("2026-07-24T10:00:00Z")), null);
  });
});
