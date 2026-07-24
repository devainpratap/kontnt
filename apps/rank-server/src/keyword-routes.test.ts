import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { FastifyInstance } from "fastify";
import type {
  ClientRecord,
  ImportKeywordsResult,
  KeywordRecord,
  KeywordSuggestionResponse,
  KeywordWithStatus
} from "@rankos/shared";

let app: FastifyInstance;
let workspaceRoot: string;
let clientId: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-keywords-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  process.env.GOOGLE_TOKEN_KEY = "a".repeat(64);
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ createRankServer }, { ensureRankDirs }, { initializeRankDatabase }] = await Promise.all([
    import("./app"),
    import("./config"),
    import("./db/client")
  ]);

  await ensureRankDirs();
  initializeRankDatabase();
  app = await createRankServer();

  const created = await app.inject({
    method: "POST",
    url: "/api/clients",
    payload: {
      name: "Keyword Co",
      primaryDomain: "keywordco.com",
      gscProperty: "sc-domain:keywordco.com",
      brandTerms: ["keywordco"],
      notes: ""
    }
  });
  clientId = (created.json() as ClientRecord).id;
});

after(async () => {
  await app?.close();
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("keyword CRUD", () => {
  it("creates a keyword with normalised phrasing", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/clients/${clientId}/keywords`,
      payload: { phrase: "  GPS   Tracker  ", country: "in", device: "desktop", tags: ["core"] }
    });

    assert.equal(response.statusCode, 201);
    const keyword = response.json() as KeywordRecord;
    assert.equal(keyword.phrase, "gps tracker");
    assert.deepEqual(keyword.tags, ["core"]);
    assert.equal(keyword.cadence, "weekly");
    assert.equal(keyword.isActive, true);
  });

  it("refuses a duplicate in the same market", async () => {
    // Duplicates would double the eventual scrape volume for no extra data.
    const response = await app.inject({
      method: "POST",
      url: `/api/clients/${clientId}/keywords`,
      payload: { phrase: "gps tracker", country: "in", device: "desktop" }
    });
    assert.equal(response.statusCode, 409);
    assert.equal((response.json() as { code: string }).code, "KEYWORD_EXISTS");
  });

  it("allows the same phrase in a different market", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/clients/${clientId}/keywords`,
      payload: { phrase: "gps tracker", country: "us", device: "mobile" }
    });
    assert.equal(response.statusCode, 201);
  });

  it("rejects an empty phrase", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/clients/${clientId}/keywords`,
      payload: { phrase: "   " }
    });
    assert.equal(response.statusCode, 400);
  });

  it("updates cadence and target URL", async () => {
    const list = (await app.inject({ method: "GET", url: `/api/clients/${clientId}/keywords` })).json() as KeywordWithStatus[];
    const target = list[0];

    const response = await app.inject({
      method: "PATCH",
      url: `/api/keywords/${target.id}`,
      payload: { cadence: "daily", targetUrl: "https://keywordco.com/gps" }
    });

    assert.equal(response.statusCode, 200);
    const updated = response.json() as KeywordRecord;
    assert.equal(updated.cadence, "daily");
    assert.equal(updated.targetUrl, "https://keywordco.com/gps");
  });

  it("returns 404 for an unknown keyword", async () => {
    const response = await app.inject({ method: "PATCH", url: "/api/keywords/nope", payload: { cadence: "daily" } });
    assert.equal(response.statusCode, 404);
  });

  it("reports no tracked rank before any check has run", async () => {
    // Never a fabricated position — an unchecked keyword is explicitly unknown.
    const list = (await app.inject({ method: "GET", url: `/api/clients/${clientId}/keywords` })).json() as KeywordWithStatus[];
    assert.ok(list.length > 0);
    assert.equal(list[0].latestCheck, null);
  });

  it("deletes a keyword", async () => {
    const created = (
      await app.inject({
        method: "POST",
        url: `/api/clients/${clientId}/keywords`,
        payload: { phrase: "delete me", country: "in", device: "desktop" }
      })
    ).json() as KeywordRecord;

    const response = await app.inject({ method: "DELETE", url: `/api/keywords/${created.id}` });
    assert.equal(response.statusCode, 204);

    const after = (await app.inject({ method: "GET", url: `/api/clients/${clientId}/keywords` })).json() as KeywordWithStatus[];
    assert.equal(after.some((entry) => entry.id === created.id), false);
  });
});

describe("bulk import", () => {
  it("imports a pasted list and reports duplicates separately", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/clients/${clientId}/keywords/import`,
      payload: {
        raw: [
          "Keyword,Target",
          "fleet management software,https://keywordco.com/fleet",
          "vehicle tracking system",
          "gps tracker",
          "https://oops.com/wrong-column"
        ].join("\n"),
        country: "in",
        device: "desktop"
      }
    });

    assert.equal(response.statusCode, 200);
    const result = response.json() as ImportKeywordsResult;
    assert.equal(result.created, 2);
    // "gps tracker" already exists in this market.
    assert.equal(result.duplicates, 1);
    assert.equal(result.invalid.length, 1);
    assert.match(result.invalid[0].reason, /URL, not a search term/i);
  });

  it("is safe to re-run — a second identical import creates nothing", async () => {
    const payload = {
      raw: "fleet management software\nvehicle tracking system",
      country: "in",
      device: "desktop"
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/clients/${clientId}/keywords/import`,
      payload
    });

    const result = response.json() as ImportKeywordsResult;
    assert.equal(result.created, 0);
    assert.equal(result.duplicates, 2);
  });

  it("rejects an empty paste", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/clients/${clientId}/keywords/import`,
      payload: { raw: "", country: "in", device: "desktop" }
    });
    assert.equal(response.statusCode, 400);
  });
});

describe("keyword suggestions", () => {
  it("returns an empty shortlist with context when there is no GSC data", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/clients/${clientId}/keywords/suggestions?days=90`
    });

    assert.equal(response.statusCode, 200);
    const payload = response.json() as KeywordSuggestionResponse;
    assert.deepEqual(payload.suggestions, []);
    assert.equal(payload.totals.candidates, 0);
    assert.equal(payload.window.days, 90);
  });

  it("rejects an out-of-range window", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/clients/${clientId}/keywords/suggestions?days=9999`
    });
    assert.equal(response.statusCode, 400);
  });

  it("returns 404 for an unknown client", async () => {
    const response = await app.inject({ method: "GET", url: "/api/clients/nope/keywords/suggestions" });
    assert.equal(response.statusCode, 404);
  });
});
