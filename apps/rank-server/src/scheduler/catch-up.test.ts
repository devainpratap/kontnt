import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SchedulerTrigger } from "@rankos/shared";

import { catchUpMissedRuns, type CatchUpTask } from "./catch-up";

const SCHEDULE: CatchUpTask[] = [
  { name: "gsc-sync", cron: "0 6 * * *" },
  { name: "weekly-reports", cron: "0 8 * * 1" }
];

const NOW = new Date("2026-07-24T10:00:00Z");
const A_PAST_FIRE = new Date("2026-07-24T00:00:00Z");

function makeRunners(calls: Array<[string, SchedulerTrigger]>) {
  return {
    "gsc-sync": async (t: SchedulerTrigger) => {
      calls.push(["gsc-sync", t]);
    },
    "weekly-reports": async (t: SchedulerTrigger) => {
      calls.push(["weekly-reports", t]);
    }
  };
}

describe("catchUpMissedRuns", () => {
  it("runs every task that has not run since its last scheduled fire", async () => {
    const calls: Array<[string, SchedulerTrigger]> = [];
    const result = await catchUpMissedRuns({
      trigger: "boot",
      now: NOW,
      schedule: SCHEDULE,
      runners: makeRunners(calls),
      fire: () => A_PAST_FIRE,
      hasRunSince: () => false
    });
    assert.deepEqual([...result.recovered].sort(), ["gsc-sync", "weekly-reports"]);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(([, trigger]) => trigger === "boot"), "runners receive the boot trigger");
  });

  it("skips a task that already ran since its fire, recovering only the missed one", async () => {
    const calls: Array<[string, SchedulerTrigger]> = [];
    const result = await catchUpMissedRuns({
      trigger: "heartbeat",
      now: NOW,
      schedule: SCHEDULE,
      runners: makeRunners(calls),
      fire: () => A_PAST_FIRE,
      // gsc-sync ran on time; weekly-reports slept through its fire.
      hasRunSince: (name) => name === "gsc-sync"
    });
    assert.deepEqual(result.recovered, ["weekly-reports"]);
    assert.deepEqual(calls, [["weekly-reports", "heartbeat"]]);
  });

  it("does nothing when every task has already run", async () => {
    const calls: Array<[string, SchedulerTrigger]> = [];
    const result = await catchUpMissedRuns({
      trigger: "heartbeat",
      now: NOW,
      schedule: SCHEDULE,
      runners: makeRunners(calls),
      fire: () => A_PAST_FIRE,
      hasRunSince: () => true
    });
    assert.deepEqual(result.recovered, []);
    assert.equal(calls.length, 0);
  });

  it("skips a task whose cron cannot be anchored to a fire", async () => {
    const calls: Array<[string, SchedulerTrigger]> = [];
    const result = await catchUpMissedRuns({
      trigger: "boot",
      now: NOW,
      schedule: SCHEDULE,
      runners: makeRunners(calls),
      fire: () => null, // e.g. an unparseable/disabled cron
      hasRunSince: () => false
    });
    assert.deepEqual(result.recovered, []);
    assert.equal(calls.length, 0);
  });

  it("continues past a runner that throws, still recovering the others", async () => {
    const calls: Array<[string, SchedulerTrigger]> = [];
    const runners = {
      "gsc-sync": async () => {
        throw new Error("sync exploded");
      },
      "weekly-reports": async (t: SchedulerTrigger) => {
        calls.push(["weekly-reports", t]);
      }
    };
    const result = await catchUpMissedRuns({
      trigger: "boot",
      now: NOW,
      schedule: SCHEDULE,
      runners,
      fire: () => A_PAST_FIRE,
      hasRunSince: () => false
    });
    // The thrower is not counted as recovered; the other still runs.
    assert.deepEqual(result.recovered, ["weekly-reports"]);
    assert.deepEqual(calls, [["weekly-reports", "boot"]]);
  });
});
