import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// Point the whole config singleton (dbPath, jobsRoot, dataRoot) at a throwaway
// workspace BEFORE importing any config-aware module. config.ts parses
// process.env at import time and db/client.ts opens the sqlite file at import
// time, so these must be set first and the real modules pulled in dynamically.
const workspaceRoot = mkdtempSync(join(tmpdir(), "reconcile-test-"));
mkdirSync(join(workspaceRoot, "data"), { recursive: true });
mkdirSync(join(workspaceRoot, "jobs"), { recursive: true });
process.env.WORKFLOW_ROOT = workspaceRoot;

// Loaded in before() once env is in place.
let initializeDatabase: () => void;
let JobRepository: typeof import("./jobs/repository").JobRepository;
let jobStepsTable: typeof import("./db/schema").jobStepsTable;
let jobsTable: typeof import("./db/schema").jobsTable;
let workflowSteps: readonly string[];

before(async () => {
  ({ initializeDatabase } = await import("./db/client"));
  ({ JobRepository } = await import("./jobs/repository"));
  ({ jobStepsTable, jobsTable } = await import("./db/schema"));
  ({ workflowSteps } = await import("@semantic-seo/shared"));

  // Runs the generated migrations against the fresh temp DB: creates the
  // tables and the job_steps indexes (exercises migration path #1 too).
  initializeDatabase();
});

after(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

test("reconcileInterruptedSteps flips orphaned running steps to failed and marks the job errored", async () => {
  const repo = new JobRepository();
  const job = await repo.createJob("Interrupted Article");

  // Simulate a server crash mid-generation: one step is left "running".
  const runningStep = workflowSteps[0] as never;
  repo.startStep(job.id, runningStep, "prompt.md", "output.md");

  const before = repo.getJobSteps(job.id).find((step) => step.stepName === runningStep);
  assert.equal(before?.status, "running", "precondition: step should be running");

  const result = repo.reconcileInterruptedSteps();

  assert.equal(result.steps, 1, "one step should have been reconciled");
  assert.equal(result.jobs, 1, "one job should have been reconciled");

  const after = repo.getJobSteps(job.id).find((step) => step.stepName === runningStep);
  assert.equal(after?.status, "failed", "step status should be failed");
  assert.equal(after?.errorMessage, "Interrupted by server restart");
  assert.ok(after?.completedAt, "step completedAt should be set");

  const reloadedJob = repo.getJobOrThrow(job.id);
  assert.equal(reloadedJob.status, "error", "job status should be error");

  // Steps that were never running must be left alone.
  const untouched = repo
    .getJobSteps(job.id)
    .filter((step) => step.stepName !== runningStep);
  assert.ok(
    untouched.every((step) => step.status === "idle"),
    "non-running steps should remain idle"
  );

  // A second reconcile with nothing running is a no-op.
  const secondRun = repo.reconcileInterruptedSteps();
  assert.deepEqual(secondRun, { steps: 0, jobs: 0 });

  // Reference the table symbols so the schema module (with its indexes) is
  // loaded and typechecked as part of this test.
  assert.ok(jobStepsTable);
  assert.ok(jobsTable);
});
