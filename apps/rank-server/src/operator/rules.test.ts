import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RULE_THRESHOLDS, evaluateRules, summariseFindings } from "./rules";
import type { ClientSnapshot, OperatorSnapshot } from "./snapshot";

function client(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    id: "c1",
    name: "AdClear",
    slug: "adclear",
    gscProperty: "https://adclear.in/",
    lastSyncAt: "2026-07-23T06:00:00Z",
    lastSyncStatus: "completed",
    syncFailStreak: 0,
    latestGscDate: "2026-07-22",
    staleGscDays: 1,
    checkHealth: { ok: 40, notFound: 2, blocked: 0, error: 0 },
    blockedRate: 0,
    coverageRatio: 0.58,
    strikingDistanceCount: 3,
    ...overrides
  };
}

function snapshot(overrides: Partial<OperatorSnapshot> = {}): OperatorSnapshot {
  return {
    takenAt: "2026-07-24T03:00:00Z",
    google: { connected: true, needsReconnect: false, lastErrorMessage: null },
    providers: [
      { provider: "serpapi", used: 40, monthlyFree: 250, remaining: 210, resetsOn: "2026-08-01" },
      { provider: "scrapingrobot", used: 100, monthlyFree: 5000, remaining: 4900, resetsOn: "2026-08-01" },
      { provider: "dataforseo", used: 0, monthlyFree: 0, remaining: null, resetsOn: "2026-08-01" }
    ],
    scheduler: { enabled: true },
    email: { enabled: true, configured: true, to: "devain@adclear.in" },
    db: { sizeBytes: 60_000_000, gscDailyRows: 90_000, oldestGscDate: "2025-03-22" },
    stuckSyncRuns: 0,
    stuckInsights: 0,
    recoveredRuns7d: 0,
    clients: [client()],
    ...overrides
  };
}

const kinds = (snap: OperatorSnapshot) => evaluateRules(snap).map((f) => f.kind);

describe("evaluateRules — a healthy system", () => {
  it("produces no findings when everything is fine", () => {
    assert.deepEqual(evaluateRules(snapshot()), []);
    assert.equal(summariseFindings([]).health, "ok");
  });
});

describe("evaluateRules — operations", () => {
  it("escalates a dead Google token as critical", () => {
    const findings = evaluateRules(snapshot({ google: { connected: true, needsReconnect: true, lastErrorMessage: "invalid_grant" } }));
    const f = findings.find((x) => x.kind === "google-token-dead");
    assert.ok(f);
    assert.equal(f.severity, "critical");
    assert.equal(f.disposition, "escalate");
    assert.match(f.recommendedAction ?? "", /reconnect/i);
  });

  it("auto-dispositions stuck running rows (the Operator can reconcile them)", () => {
    const findings = evaluateRules(snapshot({ stuckSyncRuns: 2, stuckInsights: 1 }));
    const f = findings.find((x) => x.kind === "stuck-running-rows");
    assert.ok(f);
    assert.equal(f.disposition, "auto");
  });

  it("auto-dispositions DB growth past retention", () => {
    const findings = evaluateRules(snapshot({ db: { sizeBytes: 200_000_000, gscDailyRows: 300_000, oldestGscDate: "2025-03-22" } }));
    const f = findings.find((x) => x.kind === "db-over-retention");
    assert.ok(f);
    assert.equal(f.disposition, "auto");
  });

  it("treats an exhausted provider as harmless when a fallback follows it", () => {
    const snap = snapshot();
    snap.providers[0].remaining = 0; // serpapi exhausted, but scrapingrobot follows
    const f = evaluateRules(snap).find((x) => x.kind === "provider-quota-exhausted");
    assert.ok(f);
    assert.equal(f.disposition, "suggestion");
    assert.equal(f.severity, "info");
  });

  it("escalates an exhausted provider when nothing free follows it", () => {
    // Only serpapi in the chain, and it is spent.
    const snap = snapshot({
      providers: [{ provider: "serpapi", used: 250, monthlyFree: 250, remaining: 0, resetsOn: "2026-08-01" }]
    });
    const f = evaluateRules(snap).find((x) => x.kind === "provider-quota-exhausted");
    assert.ok(f);
    assert.equal(f.disposition, "escalate");
  });
});

describe("evaluateRules — per client", () => {
  it("escalates a repeated sync failure as critical", () => {
    const findings = evaluateRules(snapshot({ clients: [client({ syncFailStreak: RULE_THRESHOLDS.syncFailStreak })] }));
    const f = findings.find((x) => x.kind === "sync-failing-repeatedly");
    assert.ok(f);
    assert.equal(f.severity, "critical");
    assert.equal(f.disposition, "escalate");
  });

  it("auto-retries a single recent sync failure", () => {
    const findings = evaluateRules(snapshot({ clients: [client({ syncFailStreak: 1 })] }));
    const f = findings.find((x) => x.kind === "sync-recently-failed");
    assert.ok(f);
    assert.equal(f.disposition, "auto");
  });

  it("flags stale data as an auto-fixable sync when the token is healthy", () => {
    const findings = evaluateRules(snapshot({ clients: [client({ staleGscDays: 6 })] }));
    const f = findings.find((x) => x.kind === "gsc-data-stale");
    assert.ok(f);
    assert.equal(f.disposition, "auto");
  });

  it("does not flag stale data when Google is disconnected (that is the real problem)", () => {
    const findings = evaluateRules(
      snapshot({
        google: { connected: false, needsReconnect: false, lastErrorMessage: null },
        clients: [client({ staleGscDays: 30 })]
      })
    );
    assert.equal(findings.some((f) => f.kind === "gsc-data-stale"), false);
    assert.ok(findings.some((f) => f.kind === "google-not-connected"));
  });

  it("escalates a high block rate as a data-quality problem", () => {
    const findings = evaluateRules(
      snapshot({ clients: [client({ checkHealth: { ok: 5, notFound: 0, blocked: 10, error: 2 }, blockedRate: 12 / 17 })] })
    );
    const f = findings.find((x) => x.kind === "keyword-block-rate-high");
    assert.ok(f);
    assert.equal(f.category, "quality");
    assert.equal(f.disposition, "escalate");
  });

  it("does not flag block rate on too few checks to be a signal", () => {
    const findings = evaluateRules(snapshot({ clients: [client({ checkHealth: { ok: 0, notFound: 0, blocked: 2, error: 0 }, blockedRate: 1 })] }));
    assert.equal(findings.some((f) => f.kind === "keyword-block-rate-high"), false);
  });

  it("surfaces a striking-distance cluster as an improvement suggestion", () => {
    const findings = evaluateRules(snapshot({ clients: [client({ strikingDistanceCount: 12 })] }));
    const f = findings.find((x) => x.kind === "striking-distance-cluster");
    assert.ok(f);
    assert.equal(f.category, "improvement");
    assert.equal(f.disposition, "suggestion");
  });

  it("suggests linking a property for a client without one", () => {
    const findings = evaluateRules(snapshot({ clients: [client({ gscProperty: null })] }));
    assert.ok(findings.some((f) => f.kind === "client-no-property"));
  });

  it("suggests auto-wake when scheduled runs are frequently recovered late", () => {
    const findings = evaluateRules(snapshot({ recoveredRuns7d: 4 }));
    const f = findings.find((x) => x.kind === "runs-recovered-late");
    assert.ok(f);
    assert.equal(f.disposition, "suggestion");
    assert.equal(f.severity, "info");
    assert.match(f.recommendedAction ?? "", /wake|always-on/i);
  });

  it("does not flag late recovery below the threshold", () => {
    assert.ok(!kinds(snapshot({ recoveredRuns7d: 2 })).includes("runs-recovered-late"));
  });
});

describe("summariseFindings", () => {
  it("rolls health up to the worst severity and counts dispositions", () => {
    const findings = evaluateRules(
      snapshot({
        google: { connected: true, needsReconnect: true, lastErrorMessage: "x" },
        stuckSyncRuns: 1,
        clients: [client({ strikingDistanceCount: 15 })]
      })
    );
    const summary = summariseFindings(findings);
    assert.equal(summary.health, "critical"); // the dead token
    assert.ok(summary.autoCount >= 1); // stuck rows
    assert.ok(summary.escalateCount >= 1); // the token
    assert.ok(summary.suggestionCount >= 1); // striking distance
  });
});
