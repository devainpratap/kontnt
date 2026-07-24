import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

/**
 * Regression guard for a bug that put the database and every client folder
 * inside apps/rank-server/ instead of the repo root.
 *
 * npm workspace scripts run with cwd = apps/rank-server, so the relative
 * defaults in .env (WORKFLOW_ROOT=".", RANK_DB_PATH="./data/rank.sqlite",
 * CLIENTS_ROOT="./clients") must resolve against the repo root, not the cwd.
 * The failure mode was quiet: the server booted, wrote a second database, and
 * simply showed no clients.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("path resolution is independent of the process cwd", () => {
  it("resolves relative env paths against the repo root", async () => {
    const original = cwd();
    // Simulate an npm workspace script's cwd.
    chdir(resolve(repoRoot, "apps/rank-server"));

    process.env.WORKFLOW_ROOT = ".";
    process.env.RANK_DB_PATH = "./data/rank.sqlite";
    process.env.CLIENTS_ROOT = "./clients";

    try {
      const { rankConfig } = await import(`./config?cwd-test=${Date.now()}`);

      assert.equal(rankConfig.workspaceRoot, repoRoot);
      assert.equal(rankConfig.dbPath, resolve(repoRoot, "data/rank.sqlite"));
      assert.equal(rankConfig.clientsRoot, resolve(repoRoot, "clients"));

      // The specific wrong answers this test exists to catch.
      assert.notEqual(rankConfig.dbPath, resolve(repoRoot, "apps/rank-server/data/rank.sqlite"));
      assert.notEqual(rankConfig.clientsRoot, resolve(repoRoot, "apps/rank-server/clients"));
    } finally {
      chdir(original);
    }
  });

  it("respects absolute overrides as given", async () => {
    const absoluteDb = resolve(tmpdir(), "rankos-abs", "rank.sqlite");
    const absoluteClients = resolve(tmpdir(), "rankos-abs", "clients");

    process.env.WORKFLOW_ROOT = ".";
    process.env.RANK_DB_PATH = absoluteDb;
    process.env.CLIENTS_ROOT = absoluteClients;

    const { rankConfig } = await import(`./config?abs-test=${Date.now()}`);

    assert.equal(rankConfig.dbPath, absoluteDb);
    assert.equal(rankConfig.clientsRoot, absoluteClients);
  });

  it("rejects a SERP delay range that is inverted", async () => {
    process.env.WORKFLOW_ROOT = ".";
    delete process.env.RANK_DB_PATH;
    delete process.env.CLIENTS_ROOT;
    process.env.SERP_MIN_DELAY_MS = "90000";
    process.env.SERP_MAX_DELAY_MS = "1000";

    await assert.rejects(
      () => import(`./config?delay-test=${Date.now()}`),
      /SERP_MIN_DELAY_MS/
    );

    delete process.env.SERP_MIN_DELAY_MS;
    delete process.env.SERP_MAX_DELAY_MS;
  });
});
