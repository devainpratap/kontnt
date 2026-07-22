import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { JobRunnerRegistry, StepAlreadyRunningError } from "./generation/job-runner";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("JobRunnerRegistry", () => {
  it("runs fn detached, reports isRunning, and clears on settle", async () => {
    const registry = new JobRunnerRegistry();
    const gate = deferred();
    let started = false;

    registry.start("job-1", "draft", async () => {
      started = true;
      await gate.promise;
    });

    // start() does not await fn — control returns immediately while in-flight.
    assert.equal(registry.isRunning("job-1", "draft"), true);
    await delay(0);
    assert.equal(started, true);

    gate.resolve();
    // Let the finally block run and remove the entry.
    await delay(0);
    assert.equal(registry.isRunning("job-1", "draft"), false);
  });

  it("rejects a second start for the same (jobId, stepName) with a typed error", async () => {
    const registry = new JobRunnerRegistry();
    const gate = deferred();

    registry.start("job-1", "draft", async () => {
      await gate.promise;
    });

    assert.throws(
      () => registry.start("job-1", "draft", async () => {}),
      (error: unknown) => {
        assert.ok(error instanceof StepAlreadyRunningError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "STEP_ALREADY_RUNNING");
        return true;
      }
    );

    gate.resolve();
    await delay(0);
  });

  it("allows different steps (and different jobs) to run concurrently", async () => {
    const registry = new JobRunnerRegistry();
    const gateA = deferred();
    const gateB = deferred();

    registry.start("job-1", "draft", async () => {
      await gateA.promise;
    });
    registry.start("job-1", "outline", async () => {
      await gateB.promise;
    });

    assert.equal(registry.isRunning("job-1", "draft"), true);
    assert.equal(registry.isRunning("job-1", "outline"), true);
    assert.equal(registry.isRunning("job-2", "draft"), false);

    gateA.resolve();
    gateB.resolve();
    await delay(0);
  });

  it("cancel aborts the running signal and returns whether it cancelled", async () => {
    const registry = new JobRunnerRegistry();
    const gate = deferred();
    let observedAbort = false;

    registry.start("job-1", "draft", async (signal) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        gate.resolve();
      });
      await gate.promise;
    });

    assert.equal(registry.cancel("job-1", "outline"), false, "nothing running for that step");
    assert.equal(registry.cancel("job-1", "draft"), true, "cancels the in-flight run");

    await gate.promise;
    assert.equal(observedAbort, true);
    await delay(0);
    assert.equal(registry.isRunning("job-1", "draft"), false);
    assert.equal(registry.cancel("job-1", "draft"), false, "already settled");
  });

  it("swallows a rejected fn without crashing and still clears the entry", async () => {
    const registry = new JobRunnerRegistry();
    const gate = deferred();

    registry.start("job-1", "draft", async () => {
      await gate.promise;
      throw new Error("boom");
    });

    assert.equal(registry.isRunning("job-1", "draft"), true);
    gate.resolve();
    // Allow the detached async IIFE (await + throw + finally) to fully settle.
    await delay(10);
    assert.equal(registry.isRunning("job-1", "draft"), false);
  });
});
