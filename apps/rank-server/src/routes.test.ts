import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { FastifyInstance } from "fastify";
import type { ClientRecord, ClientSummary, RankAppSettings } from "@rankos/shared";

let app: FastifyInstance;
let workspaceRoot: string;

before(async () => {
  // Point the whole app at a throwaway workspace before anything imports
  // config, so the real data/ and clients/ folders are never touched.
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-routes-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  process.env.RANK_HOST = "127.0.0.1";
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ createRankServer }, { ensureRankDirs }, { initializeRankDatabase }] = await Promise.all([
    import("./app"),
    import("./config"),
    import("./db/client")
  ]);

  await ensureRankDirs();
  initializeRankDatabase();
  app = await createRankServer();
});

after(async () => {
  await app?.close();
  await rm(workspaceRoot, { recursive: true, force: true });
});

async function createClient(overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/clients",
    payload: {
      name: "Acme Logistics",
      primaryDomain: "acmelogistics.com",
      gscProperty: "sc-domain:acmelogistics.com",
      brandTerms: ["acme"],
      notes: "Pilot account",
      ...overrides
    }
  });
}

describe("health and settings", () => {
  it("reports service health", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true, service: "rankos" });
  });

  it("reports unconnected data sources honestly rather than claiming readiness", async () => {
    const response = await app.inject({ method: "GET", url: "/api/settings" });
    assert.equal(response.statusCode, 200);

    const settings = response.json() as RankAppSettings;
    // Google has not been connected in this workspace, so it must say so.
    assert.equal(settings.google.connected, false);

    // The SERP provider's availability depends on whether Chrome (or an API
    // key) exists on the machine running the tests, so assert the contract
    // rather than a particular answer: a named provider that always explains
    // its state, never a bare boolean with no reason.
    assert.ok(settings.serp.name.length > 0);
    assert.equal(typeof settings.serp.available, "boolean");
    assert.ok(settings.serp.message.length > 0);
  });
});

describe("POST /api/clients", () => {
  it("creates a client, its folder tree, and its client.json record", async () => {
    const response = await createClient({ name: "Folder Check", primaryDomain: "folder-check.com" });
    assert.equal(response.statusCode, 201);

    const client = response.json() as ClientRecord;
    assert.equal(client.name, "Folder Check");
    assert.equal(client.slug, "folder-check");
    assert.equal(client.gscPropertyType, "domain");
    assert.deepEqual(client.brandTerms, ["acme"]);
    assert.equal(client.archivedAt, null);

    // Files on disk are the source of truth — the folder tree and the
    // client.json mirror must both exist immediately after creation.
    for (const dir of ["gsc", "serp", "insights", "prompts", "exports"]) {
      await access(join(client.clientPath, dir));
    }
    const mirrored = JSON.parse(await readFile(join(client.clientPath, "client.json"), "utf8")) as ClientRecord;
    assert.equal(mirrored.id, client.id);
  });

  it("detects a url-prefix property", async () => {
    const response = await createClient({
      name: "Prefix Co",
      primaryDomain: "prefix.com",
      gscProperty: "https://prefix.com/"
    });
    assert.equal(response.statusCode, 201);
    assert.equal((response.json() as ClientRecord).gscPropertyType, "url-prefix");
  });

  it("rejects a domain that was pasted as a URL", async () => {
    // A scheme/path would never match a SERP hostname, so it must fail loudly
    // at intake rather than silently never matching.
    const response = await createClient({ primaryDomain: "https://acmelogistics.com/blog" });
    assert.equal(response.statusCode, 400);
    assert.match((response.json() as { error: string }).error, /bare domain/i);
  });

  it("rejects an empty name", async () => {
    const response = await createClient({ name: "  " });
    assert.equal(response.statusCode, 400);
  });

  it("rejects a malformed Search Console property", async () => {
    const response = await createClient({ name: "Bad Prop", primaryDomain: "badprop.com", gscProperty: "badprop.com" });
    assert.equal(response.statusCode, 400);
  });

  it("gives colliding names distinct slugs and folders", async () => {
    const first = (await createClient({ name: "Same Name", primaryDomain: "same-one.com" })).json() as ClientRecord;
    const second = (await createClient({ name: "Same Name!", primaryDomain: "same-two.com" })).json() as ClientRecord;

    assert.notEqual(first.slug, second.slug);
    assert.notEqual(first.clientPath, second.clientPath);
  });

  it("does not let a crafted name escape the clients directory", async () => {
    const response = await createClient({ name: "../../../etc/passwd", primaryDomain: "traversal.com" });
    assert.equal(response.statusCode, 201);

    const client = response.json() as ClientRecord;
    assert.ok(client.clientPath.startsWith(join(workspaceRoot, "clients")));
    assert.ok(!client.clientPath.includes(".."));
  });
});

describe("GET /api/clients", () => {
  it("returns summary counts and excludes archived clients by default", async () => {
    const created = (await createClient({ name: "Archive Me", primaryDomain: "archive-me.com" })).json() as ClientRecord;

    const listed = (await app.inject({ method: "GET", url: "/api/clients" })).json() as ClientSummary[];
    const found = listed.find((entry) => entry.id === created.id);
    assert.ok(found, "newly created client should be listed");
    // No keywords or alerts exist yet; the counts must be zero, not undefined.
    assert.equal(found.keywordCount, 0);
    assert.equal(found.activeKeywordCount, 0);
    assert.equal(found.unacknowledgedAlertCount, 0);
    assert.equal(found.lastGscSyncAt, null);
    assert.equal(found.lastSerpCheckAt, null);

    const archived = await app.inject({
      method: "PATCH",
      url: `/api/clients/${created.id}`,
      payload: { archived: true }
    });
    assert.equal(archived.statusCode, 200);
    assert.ok((archived.json() as ClientRecord).archivedAt);

    const afterArchive = (await app.inject({ method: "GET", url: "/api/clients" })).json() as ClientSummary[];
    assert.equal(afterArchive.some((entry) => entry.id === created.id), false);

    const withArchived = (
      await app.inject({ method: "GET", url: "/api/clients?includeArchived=true" })
    ).json() as ClientSummary[];
    assert.equal(withArchived.some((entry) => entry.id === created.id), true);
  });
});

describe("GET and PATCH /api/clients/:clientId", () => {
  it("returns 404 for an unknown client", async () => {
    const response = await app.inject({ method: "GET", url: "/api/clients/does-not-exist" });
    assert.equal(response.statusCode, 404);
    assert.equal((response.json() as { code: string }).code, "CLIENT_NOT_FOUND");
  });

  it("updates fields and rewrites the on-disk mirror", async () => {
    const created = (await createClient({ name: "Patch Me", primaryDomain: "patch-me.com" })).json() as ClientRecord;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/clients/${created.id}`,
      payload: { notes: "Renewed for 2027", brandTerms: ["patch", "patchme"] }
    });
    assert.equal(response.statusCode, 200);

    const updated = response.json() as ClientRecord;
    assert.equal(updated.notes, "Renewed for 2027");
    assert.deepEqual(updated.brandTerms, ["patch", "patchme"]);
    assert.notEqual(updated.updatedAt, created.updatedAt);

    const mirrored = JSON.parse(await readFile(join(updated.clientPath, "client.json"), "utf8")) as ClientRecord;
    assert.equal(mirrored.notes, "Renewed for 2027");
  });

  it("unarchives a client", async () => {
    const created = (await createClient({ name: "Restore Me", primaryDomain: "restore-me.com" })).json() as ClientRecord;

    await app.inject({ method: "PATCH", url: `/api/clients/${created.id}`, payload: { archived: true } });
    const restored = await app.inject({
      method: "PATCH",
      url: `/api/clients/${created.id}`,
      payload: { archived: false }
    });

    assert.equal((restored.json() as ClientRecord).archivedAt, null);
  });

  it("rejects an invalid patch payload", async () => {
    const created = (await createClient({ name: "Invalid Patch", primaryDomain: "invalid-patch.com" })).json() as ClientRecord;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/clients/${created.id}`,
      payload: { primaryDomain: "not a domain" }
    });
    assert.equal(response.statusCode, 400);
  });
});
