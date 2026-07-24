import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { Finding } from "./rules";

let remediation: typeof import("./remediation");
let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-remediation-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ ensureRankDirs }, dbClient] = await Promise.all([import("../config"), import("../db/client")]);
  await ensureRankDirs();
  dbClient.initializeRankDatabase();
  remediation = await import("./remediation");
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function finding(kind: string, clientId: string | null = null): Finding {
  return { kind, severity: "warn", category: "ops", disposition: "auto", clientId, summary: kind };
}

describe("remediation allowlist", () => {
  it("recognises only allowlisted kinds", () => {
    assert.equal(remediation.isRemediable("stuck-running-rows"), true);
    assert.equal(remediation.isRemediable("db-over-retention"), true);
    assert.equal(remediation.isRemediable("google-token-dead"), false);
    assert.equal(remediation.isRemediable("anything-else"), false);
  });

  it("returns null for a kind not on the allowlist (never acted on)", async () => {
    // The core safety property: an off-list finding is never executed.
    assert.equal(await remediation.remediate(finding("google-token-dead")), null);
    assert.equal(await remediation.remediate(finding("striking-distance-cluster")), null);
  });

  it("reconciles stuck rows idempotently", async () => {
    const result = await remediation.remediate(finding("stuck-running-rows"));
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.match(result.description, /reconciled/i);
  });

  it("prunes old data idempotently (nothing to prune on an empty DB)", async () => {
    const result = await remediation.remediate(finding("db-over-retention"));
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.match(result.description, /prune/i);
  });

  it("withholds the fix past the retry cap and signals escalation", async () => {
    // A persistently failing fix must not become a retry storm.
    const result = await remediation.remediate(finding("stuck-running-rows"), { attemptCount: 3, maxAttempts: 3 });
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.match(result.description, /withheld|escalat/i);
  });

  it("skips a sync retry when the client has no property or Google is off", async () => {
    const result = await remediation.remediate(finding("sync-recently-failed", "nonexistent-client"));
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.match(result.description, /skipped/i);
  });
});
