import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

let db: typeof import("../db/client").db;
let schema: typeof import("../db/schema");
let OperatorService: typeof import("./operator-service").OperatorService;
let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-operator-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  // Claude and email off so the run is deterministic and offline.
  process.env.CLAUDE_CLI_BIN = "/nonexistent-claude-for-test";
  process.env.EMAIL_ENABLED = "false";
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ ensureRankDirs }, dbClient, dbSchema, { ClientRepository }, svc] = await Promise.all([
    import("../config"),
    import("../db/client"),
    import("../db/schema"),
    import("../clients/repository"),
    import("./operator-service")
  ]);
  await ensureRankDirs();
  dbClient.initializeRankDatabase();
  db = dbClient.db;
  schema = dbSchema;
  OperatorService = svc.OperatorService;

  // A linked client, and a sync run left "running" (a crash artifact).
  await new ClientRepository().createClient({
    name: "Op Co", primaryDomain: "opco.com", gscProperty: "sc-domain:opco.com", brandTerms: [], notes: ""
  });
  db.insert(schema.syncRunsTable).values({
    id: randomUUID(), clientId: null, kind: "gsc-sync", status: "running",
    startedAt: new Date().toISOString(), completedAt: null,
    rowsWritten: 0, itemsOk: 0, itemsBlocked: 0, itemsFailed: 0, errorMessage: null
  }).run();
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("OperatorService.run", () => {
  it("auto-fixes the stuck row and records a journal + run row (apply on)", async () => {
    const result = await new OperatorService().run({ apply: true });

    // The stuck running row is on the allowlist, so it is auto-reconciled.
    assert.ok(result.record.actionsCount >= 1, "should have auto-fixed the stuck row");
    assert.equal(db.select().from(schema.syncRunsTable).all().filter((r) => r.status === "running").length, 0);

    // A run row and a journal file were written.
    const runs = db.select().from(schema.operatorRunsTable).all();
    assert.equal(runs.length, 1);
    assert.ok(runs[0].journalPath, "journal path recorded");
  });

  it("takes no action in recommend mode (apply off)", async () => {
    // Re-seed a stuck row; recommend mode must observe but not fix it.
    db.insert(schema.syncRunsTable).values({
      id: randomUUID(), clientId: null, kind: "gsc-sync", status: "running",
      startedAt: new Date().toISOString(), completedAt: null,
      rowsWritten: 0, itemsOk: 0, itemsBlocked: 0, itemsFailed: 0, errorMessage: null
    }).run();

    const result = await new OperatorService().run({ apply: false });
    assert.equal(result.record.actionsCount, 0, "recommend mode fixes nothing");
    // The stuck row is still there - it was seen (a finding) but not acted on.
    assert.ok(db.select().from(schema.syncRunsTable).all().some((r) => r.status === "running"));
    assert.ok(result.findings.some((f) => f.kind === "stuck-running-rows"));
  });

  it("degrades gracefully when Claude is unavailable (offline journal still written)", async () => {
    // CLAUDE_CLI_BIN points at nothing, so the reasoning pass fails - the
    // deterministic journal must still be produced.
    const result = await new OperatorService().run({ apply: true });
    assert.ok(result.record.id);
    const journal = await new OperatorService().getJournal().readJournal(result.record.id);
    assert.match(journal ?? "", /Operator run/);
  });
});
