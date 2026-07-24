import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import type { SearchAnalyticsRow } from "./api-client";

let workspaceRoot: string;
let sync: import("./sync").GscSyncService;
let clientId: string;
let db: typeof import("../db/client").db;
let schema: typeof import("../db/schema");

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "rankos-sync-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.RANK_DB_PATH = join(workspaceRoot, "data", "rank.sqlite");
  process.env.CLIENTS_ROOT = join(workspaceRoot, "clients");
  process.env.GOOGLE_TOKEN_KEY = "a".repeat(64);
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ ensureRankDirs }, dbClient, dbSchema, { ClientRepository }, { GscSyncService }] = await Promise.all([
    import("../config"),
    import("../db/client"),
    import("../db/schema"),
    import("../clients/repository"),
    import("./sync")
  ]);

  await ensureRankDirs();
  dbClient.initializeRankDatabase();
  db = dbClient.db;
  schema = dbSchema;

  const client = await new ClientRepository().createClient({
    name: "Sync Test",
    primaryDomain: "synctest.com",
    gscProperty: "sc-domain:synctest.com",
    brandTerms: [],
    notes: ""
  });
  clientId = client.id;
  sync = new GscSyncService();
});

after(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

function row(date: string, query: string, page: string, clicks: number, impressions: number, position: number): SearchAnalyticsRow {
  return {
    keys: [date, query, page],
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position
  };
}

function totalsRow(date: string, clicks: number, impressions: number, position: number): SearchAnalyticsRow {
  return { keys: [date], clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position };
}

function countDaily(): number {
  return (
    db.select().from(schema.gscDailyTable).all().filter((entry) => entry.clientId === clientId).length
  );
}

function readDaily(date: string, query: string, page: string) {
  return db
    .select()
    .from(schema.gscDailyTable)
    .all()
    .find(
      (entry) =>
        entry.clientId === clientId && entry.date === date && entry.query === query && entry.page === page
    );
}

describe("writeDailyRows idempotency", () => {
  const batch = [
    row("2026-07-20", "gps tracker", "https://synctest.com/gps", 10, 100, 4.2),
    row("2026-07-20", "vehicle tracker", "https://synctest.com/vehicle", 5, 80, 7.1),
    row("2026-07-21", "gps tracker", "https://synctest.com/gps", 12, 110, 3.9)
  ];

  it("writes the rows on first sync", () => {
    assert.equal(sync.writeDailyRows(clientId, batch), 3);
    assert.equal(countDaily(), 3);
  });

  it("re-syncing the same window changes nothing", () => {
    // The property the whole design rests on. If this fails, every number
    // downstream is inflated and the dashboard cannot be trusted.
    sync.writeDailyRows(clientId, batch);
    sync.writeDailyRows(clientId, batch);
    assert.equal(countDaily(), 3);
  });

  it("overwrites revised values rather than inserting duplicates", () => {
    // Google revises recent days. The revised figure must replace the old one.
    const revised = [row("2026-07-20", "gps tracker", "https://synctest.com/gps", 18, 140, 3.4)];
    sync.writeDailyRows(clientId, revised);

    assert.equal(countDaily(), 3);
    const stored = readDaily("2026-07-20", "gps tracker", "https://synctest.com/gps");
    assert.equal(stored?.clicks, 18);
    assert.equal(stored?.impressions, 140);
    assert.equal(stored?.position, 3.4);
  });

  it("treats the same query on a different page as a distinct row", () => {
    // Two pages ranking for one query is the cannibalization signal; collapsing
    // them would erase it.
    sync.writeDailyRows(clientId, [
      row("2026-07-20", "gps tracker", "https://synctest.com/gps-2", 3, 40, 9.5)
    ]);
    assert.equal(countDaily(), 4);
  });

  it("returns zero for an empty batch", () => {
    assert.equal(sync.writeDailyRows(clientId, []), 0);
    assert.equal(countDaily(), 4);
  });

  it("handles a batch larger than one chunk without duplicating", () => {
    const large = Array.from({ length: 250 }, (_, index) =>
      row("2026-06-01", `keyword ${index}`, `https://synctest.com/p${index}`, index, index * 10, 1 + (index % 50))
    );

    assert.equal(sync.writeDailyRows(clientId, large), 250);
    const afterFirst = countDaily();

    sync.writeDailyRows(clientId, large);
    assert.equal(countDaily(), afterFirst, "second write of the same 250 rows must not add any");
  });
});

describe("writeTotals", () => {
  it("stores one row per day and upserts on re-sync", () => {
    const totals = [totalsRow("2026-07-20", 200, 4000, 5.5), totalsRow("2026-07-21", 240, 4300, 5.1)];

    sync.writeTotals(clientId, totals);
    sync.writeTotals(clientId, totals);

    const stored = db
      .select()
      .from(schema.gscDailyTotalsTable)
      .all()
      .filter((entry) => entry.clientId === clientId);
    assert.equal(stored.length, 2);
  });

  it("captures the attribution gap that query rows structurally cannot", () => {
    // Query-level clicks for 2026-07-20 sum to 10 + 5 + 3 = 18 (as revised, 18
    // + 5 + 3 = 26), while the property total is 200. Google withholds rare
    // queries, so this gap is expected and must be visible, not hidden.
    const total = db
      .select()
      .from(schema.gscDailyTotalsTable)
      .all()
      .find((entry) => entry.clientId === clientId && entry.date === "2026-07-20");

    const attributed = db
      .select()
      .from(schema.gscDailyTable)
      .all()
      .filter((entry) => entry.clientId === clientId && entry.date === "2026-07-20")
      .reduce((sum, entry) => sum + entry.clicks, 0);

    assert.ok(total, "totals row should exist");
    assert.ok(total.clicks > attributed, "property total should exceed the sum of known queries");
  });
});

describe("rebuildWeeklyRollups", () => {
  it("aggregates a week onto its Monday", () => {
    // 2026-07-20 is a Monday; 07-21 falls in the same week.
    const weeks = sync.rebuildWeeklyRollups(clientId, ["2026-07-20", "2026-07-21"]);
    assert.equal(weeks, 1);

    const rollups = db
      .select()
      .from(schema.gscWeeklyRollupTable)
      .all()
      .filter((entry) => entry.clientId === clientId && entry.weekStart === "2026-07-20");

    const gps = rollups.find((entry) => entry.query === "gps tracker");
    assert.ok(gps, "gps tracker should be rolled up");
    // Rollups group by query across pages, so both URLs ranking for
    // "gps tracker" combine: 18 (/gps, revised) + 3 (/gps-2) on 07-20,
    // plus 12 (/gps) on 07-21.
    assert.equal(gps.clicks, 33);
    assert.equal(gps.impressions, 290);
  });

  it("weights position by impressions rather than averaging days flatly", () => {
    const gps = db
      .select()
      .from(schema.gscWeeklyRollupTable)
      .all()
      .find((entry) => entry.clientId === clientId && entry.weekStart === "2026-07-20" && entry.query === "gps tracker");

    // Weighted: (3.4*140 + 9.5*40 + 3.9*110) / 290 = 4.43.
    // A flat mean of the three positions would give 5.60 — the low-impression
    // /gps-2 row at position 9.5 would drag the whole week down by over a
    // position, which is exactly the distortion the weighting prevents.
    assert.ok(gps);
    assert.ok(Math.abs(gps.avgPosition - 4.43) < 0.01, `expected ~4.43, got ${gps.avgPosition}`);
  });

  it("is idempotent — rebuilding does not duplicate rows", () => {
    const before = db
      .select()
      .from(schema.gscWeeklyRollupTable)
      .all()
      .filter((entry) => entry.clientId === clientId && entry.weekStart === "2026-07-20").length;

    sync.rebuildWeeklyRollups(clientId, ["2026-07-20"]);
    sync.rebuildWeeklyRollups(clientId, ["2026-07-22"]);

    const after = db
      .select()
      .from(schema.gscWeeklyRollupTable)
      .all()
      .filter((entry) => entry.clientId === clientId && entry.weekStart === "2026-07-20").length;

    assert.equal(after, before);
  });

  it("returns zero when no dates are supplied", () => {
    assert.equal(sync.rebuildWeeklyRollups(clientId, []), 0);
  });
});

describe("syncClient guards", () => {
  it("refuses to sync a client with no Search Console property linked", async () => {
    const { ClientRepository } = await import("../clients/repository");
    const unlinked = await new ClientRepository().createClient({
      name: "No Property",
      primaryDomain: "noproperty.com",
      gscProperty: null,
      brandTerms: [],
      notes: ""
    });

    await assert.rejects(() => sync.syncClient({ clientId: unlinked.id }), /no Search Console property/i);
  });

  it("records a failed run rather than failing silently", async () => {
    const { ClientRepository } = await import("../clients/repository");
    const linked = await new ClientRepository().createClient({
      name: "Not Connected",
      primaryDomain: "notconnected.com",
      gscProperty: "sc-domain:notconnected.com",
      brandTerms: [],
      notes: ""
    });

    // Google is not connected in this test workspace, so the sync must fail
    // loudly and leave an auditable failed run behind.
    await assert.rejects(() => sync.syncClient({ clientId: linked.id }));

    const runs = db
      .select()
      .from(schema.syncRunsTable)
      .all()
      .filter((entry) => entry.clientId === linked.id);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "failed");
    assert.ok(runs[0].errorMessage);
    assert.ok(runs[0].completedAt);
  });
});
