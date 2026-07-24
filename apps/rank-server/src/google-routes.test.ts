import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { FastifyInstance } from "fastify";
import type { ClientRecord, GoogleConnectionStatus } from "@rankos/shared";

let app: FastifyInstance;
let workspaceRoot: string;
let linkedClientId: string;
let unlinkedClientId: string;

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-google-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  process.env.GOOGLE_TOKEN_KEY = "a".repeat(64);
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3102/api/google/callback";
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ createRankServer }, { ensureRankDirs }, { initializeRankDatabase }] = await Promise.all([
    import("./app"),
    import("./config"),
    import("./db/client")
  ]);

  await ensureRankDirs();
  initializeRankDatabase();
  app = await createRankServer();

  const linked = await app.inject({
    method: "POST",
    url: "/api/clients",
    payload: {
      name: "Linked Co",
      primaryDomain: "linked.com",
      gscProperty: "sc-domain:linked.com",
      brandTerms: [],
      notes: ""
    }
  });
  linkedClientId = (linked.json() as ClientRecord).id;

  const unlinked = await app.inject({
    method: "POST",
    url: "/api/clients",
    payload: { name: "Unlinked Co", primaryDomain: "unlinked.com", brandTerms: [], notes: "" }
  });
  unlinkedClientId = (unlinked.json() as ClientRecord).id;
});

after(async () => {
  await app?.close();
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe("GET /api/google/status", () => {
  it("reports not-connected without claiming an error", async () => {
    const response = await app.inject({ method: "GET", url: "/api/google/status" });
    assert.equal(response.statusCode, 200);

    const status = response.json() as GoogleConnectionStatus;
    assert.equal(status.connected, false);
    assert.equal(status.needsReconnect, false);
    assert.equal(status.email, null);
  });
});

describe("POST /api/google/connect", () => {
  it("returns a Google consent URL with the right parameters", async () => {
    const response = await app.inject({ method: "POST", url: "/api/google/connect" });
    assert.equal(response.statusCode, 200);

    const { authUrl } = response.json() as { authUrl: string };
    const url = new URL(authUrl);

    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), "test-client-id.apps.googleusercontent.com");
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3102/api/google/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    // Both are required for Google to return a refresh token; without them the
    // sync cannot run unattended after a restart.
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.match(url.searchParams.get("scope") ?? "", /webmasters\.readonly/);
    assert.ok((url.searchParams.get("state") ?? "").length >= 32);
  });

  it("issues a distinct state on each attempt", async () => {
    const first = new URL(((await app.inject({ method: "POST", url: "/api/google/connect" })).json() as { authUrl: string }).authUrl);
    const second = new URL(((await app.inject({ method: "POST", url: "/api/google/connect" })).json() as { authUrl: string }).authUrl);
    assert.notEqual(first.searchParams.get("state"), second.searchParams.get("state"));
  });
});

describe("GET /api/google/callback", () => {
  it("rejects an unrecognised state instead of accepting the code", async () => {
    // Without this check a crafted callback could bind someone else's Google
    // account to this install.
    const response = await app.inject({
      method: "GET",
      url: "/api/google/callback?code=abc&state=never-issued"
    });

    assert.equal(response.statusCode, 302);
    assert.match(response.headers.location as string, /google=error/);
    assert.match(decodeURIComponent(response.headers.location as string), /state/i);
  });

  it("refuses to reuse a state token", async () => {
    const { authUrl } = (await app.inject({ method: "POST", url: "/api/google/connect" })).json() as {
      authUrl: string;
    };
    const state = new URL(authUrl).searchParams.get("state") as string;

    // First use consumes it (the code is bogus, so the exchange fails, but the
    // state is spent regardless).
    await app.inject({ method: "GET", url: `/api/google/callback?code=bogus&state=${state}` });

    const replay = await app.inject({ method: "GET", url: `/api/google/callback?code=bogus&state=${state}` });
    assert.match(decodeURIComponent(replay.headers.location as string), /Expired or unrecognised state/);
  });

  it("handles a denied consent without erroring", async () => {
    const response = await app.inject({ method: "GET", url: "/api/google/callback?error=access_denied" });
    assert.equal(response.statusCode, 302);
    assert.match(response.headers.location as string, /google=denied/);
  });

  it("reports missing parameters", async () => {
    const response = await app.inject({ method: "GET", url: "/api/google/callback" });
    assert.match(response.headers.location as string, /google=error/);
  });
});

describe("sync endpoints", () => {
  it("refuses to sync a client with no property linked", async () => {
    const response = await app.inject({ method: "POST", url: `/api/clients/${unlinkedClientId}/gsc/sync` });
    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { code: string }).code, "CLIENT_NO_GSC_PROPERTY");
  });

  it("refuses to sync when Google is not connected", async () => {
    // Fails fast with a clear reason rather than starting a background run that
    // dies invisibly.
    const response = await app.inject({ method: "POST", url: `/api/clients/${linkedClientId}/gsc/sync` });
    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { code: string }).code, "GOOGLE_NOT_CONNECTED");
  });

  it("returns 404 for an unknown client", async () => {
    const response = await app.inject({ method: "POST", url: "/api/clients/nope/gsc/sync" });
    assert.equal(response.statusCode, 404);
  });

  it("reports idle sync status with no runs yet", async () => {
    const response = await app.inject({ method: "GET", url: `/api/clients/${linkedClientId}/gsc/status` });
    assert.equal(response.statusCode, 200);

    const status = response.json() as {
      running: boolean;
      bounds: { earliest: string | null; latest: string | null };
      runs: unknown[];
    };
    assert.equal(status.running, false);
    assert.equal(status.bounds.earliest, null);
    assert.deepEqual(status.runs, []);
  });
});

describe("GET /api/clients/:id/gsc/performance", () => {
  it("returns a zeroed but well-formed payload before any sync", async () => {
    // An empty dashboard must not 500 — a new client is the normal first state.
    const response = await app.inject({
      method: "GET",
      url: `/api/clients/${linkedClientId}/gsc/performance?days=28`
    });
    assert.equal(response.statusCode, 200);

    const payload = response.json() as {
      window: { days: number; startDate: string; endDate: string };
      totals: { clicks: number; position: number | null };
      daily: unknown[];
      coverage: { coverageRatio: number };
    };

    assert.equal(payload.window.days, 28);
    assert.equal(payload.totals.clicks, 0);
    // No impressions means no meaningful position; null, never 0, which would
    // read as "ranking first".
    assert.equal(payload.totals.position, null);
    assert.deepEqual(payload.daily, []);
    assert.equal(payload.coverage.coverageRatio, 0);
  });

  it("derives a start date 27 days before the end for a 28-day window", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/clients/${linkedClientId}/gsc/performance?days=28&endDate=2026-07-28`
    });
    const payload = response.json() as { window: { startDate: string; endDate: string } };
    assert.equal(payload.window.endDate, "2026-07-28");
    assert.equal(payload.window.startDate, "2026-07-01");
  });

  it("rejects an out-of-range window", async () => {
    const tooBig = await app.inject({
      method: "GET",
      url: `/api/clients/${linkedClientId}/gsc/performance?days=9999`
    });
    assert.equal(tooBig.statusCode, 400);

    const tooSmall = await app.inject({
      method: "GET",
      url: `/api/clients/${linkedClientId}/gsc/performance?days=0`
    });
    assert.equal(tooSmall.statusCode, 400);
  });
});
