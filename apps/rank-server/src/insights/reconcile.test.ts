import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

let db: typeof import("../db/client").db;
let insightsTable: typeof import("../db/schema").insightsTable;
let InsightService: typeof import("./insight-service").InsightService;
let clientId: string;
let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-reconcile-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ ensureRankDirs }, dbClient, schema, { ClientRepository }, svc] = await Promise.all([
    import("../config"),
    import("../db/client"),
    import("../db/schema"),
    import("../clients/repository"),
    import("./insight-service")
  ]);
  await ensureRankDirs();
  dbClient.initializeRankDatabase();
  db = dbClient.db;
  insightsTable = schema.insightsTable;
  InsightService = svc.InsightService;

  const client = await new ClientRepository().createClient({
    name: "Recon Co", primaryDomain: "reconco.com", gscProperty: null, brandTerms: [], notes: ""
  });
  clientId = client.id;
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function insert(status: string) {
  const id = randomUUID();
  db.insert(insightsTable).values({
    id, clientId, kind: "weekly-report", status: status as never,
    periodStart: "2026-07-16", periodEnd: "2026-07-22",
    promptPath: null, outputPath: null, briefPath: null, errorMessage: null,
    createdAt: new Date().toISOString(), completedAt: null
  }).run();
  return id;
}

describe("reconcileInterruptedInsights", () => {
  it("flips a stuck running report to failed so the UI cannot poll it forever", () => {
    // The exact bug: a report left "running" by a server restart keeps the
    // generate button spinning indefinitely.
    const stuck = insert("running");
    const done = insert("completed");

    const count = new InsightService().reconcileInterruptedInsights();
    assert.equal(count, 1);

    const svc = new InsightService();
    assert.equal(svc.getInsightOrThrow(stuck).status, "failed");
    assert.match(svc.getInsightOrThrow(stuck).errorMessage ?? "", /server restart/i);
    // A completed report is untouched.
    assert.equal(svc.getInsightOrThrow(done).status, "completed");
  });

  it("is a no-op when nothing is running", () => {
    assert.equal(new InsightService().reconcileInterruptedInsights(), 0);
  });
});
