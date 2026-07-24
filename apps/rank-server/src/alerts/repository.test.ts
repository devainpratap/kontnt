import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { ClientRecord } from "@rankos/shared";

let repo: import("./repository").AlertRepository;
let clientId: string;
let keywordId: string;
let workspaceRoot: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-alerts-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ ensureRankDirs }, dbClient, { ClientRepository }, { KeywordRepository }, { AlertRepository }] =
    await Promise.all([
      import("../config"),
      import("../db/client"),
      import("../clients/repository"),
      import("../keywords/repository"),
      import("./repository")
    ]);

  await ensureRankDirs();
  dbClient.initializeRankDatabase();

  const client: ClientRecord = await new ClientRepository().createClient({
    name: "Alert Co", primaryDomain: "alertco.com", gscProperty: null, brandTerms: [], notes: ""
  });
  clientId = client.id;
  keywordId = new KeywordRepository().createKeyword(clientId, {
    phrase: "gps tracker", country: "in", device: "desktop", tags: [], cadence: "weekly"
  }).id;

  repo = new AlertRepository();
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("AlertRepository", () => {
  it("records a proposal and lists it as unacknowledged", () => {
    const created = repo.recordForKeyword(clientId, keywordId, [
      { kind: "dropped-out-of-top-10", delta: 7, payload: { previousPosition: 8, currentPosition: 15 } }
    ]);
    assert.equal(created.length, 1);
    assert.equal(repo.unacknowledgedCount(clientId), 1);
  });

  it("de-duplicates the same alert kind on the same day", () => {
    // A keyword re-checked twice in a day must not produce two copies.
    const again = repo.recordForKeyword(clientId, keywordId, [
      { kind: "dropped-out-of-top-10", delta: 7, payload: {} }
    ]);
    assert.equal(again.length, 0, "same kind, same day should be skipped");
    assert.equal(repo.unacknowledgedCount(clientId), 1);
  });

  it("allows a different alert kind on the same day", () => {
    const created = repo.recordForKeyword(clientId, keywordId, [
      { kind: "large-move", delta: 7, payload: {} }
    ]);
    assert.equal(created.length, 1);
    assert.equal(repo.unacknowledgedCount(clientId), 2);
  });

  it("attaches the keyword phrase in the inbox view", () => {
    const listed = repo.listWithKeyword(clientId);
    assert.ok(listed.every((a) => a.phrase === "gps tracker"));
  });

  it("acknowledging removes it from the unacknowledged count", () => {
    const all = repo.listAlerts(clientId);
    repo.acknowledge(all[0].id);
    assert.equal(repo.unacknowledgedCount(clientId), 1);
  });

  it("acknowledge-all clears the rest", () => {
    const cleared = repo.acknowledgeAll(clientId);
    assert.ok(cleared >= 1);
    assert.equal(repo.unacknowledgedCount(clientId), 0);
  });

  it("ignores an empty proposal list", () => {
    assert.deepEqual(repo.recordForKeyword(clientId, keywordId, []), []);
  });
});
