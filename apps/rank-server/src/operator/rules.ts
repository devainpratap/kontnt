import { rankConfig } from "../config";
import type { OperatorSnapshot } from "./snapshot";

/**
 * The rule engine: snapshot -> findings. Pure, deterministic, unit-tested, and
 * the model is never in this path. Each finding carries how it should be
 * handled (disposition), which is what keeps the consequential/safe boundary in
 * code rather than in an LLM's judgement.
 */

export type Severity = "info" | "warn" | "critical";
export type Category = "ops" | "quality" | "improvement";

/**
 * How a finding is handled:
 * - auto: the Operator may fix it from its hardcoded allowlist.
 * - escalate: needs the operator; the Operator will not act.
 * - suggestion: informational; surfaced, never acted on.
 */
export type Disposition = "auto" | "escalate" | "suggestion";

export type Finding = {
  kind: string;
  severity: Severity;
  category: Category;
  disposition: Disposition;
  /** Which client this concerns, when applicable. */
  clientId: string | null;
  summary: string;
  /** For an escalation, the concrete thing the operator should do. */
  recommendedAction?: string;
};

/** Thresholds, in one place so tests and config agree. */
export const RULE_THRESHOLDS = {
  /** Escalate when a provider's remaining free budget drops to this fraction. */
  providerLowFraction: 0.1,
  /** A sustained sync failure (this many in a row) escalates. */
  syncFailStreak: 3,
  /** GSC data older than this many days is a stale-data warning. */
  staleGscDays: 4,
  /** Live-check block rate above this is a data-quality warning. */
  blockedRate: 0.4,
  /** Prune when gsc_daily holds more than this many rows (≈ retention pressure). */
  dbRowsHigh: 250_000,
  /** Surface a client with at least this many striking-distance keywords. */
  strikingDistanceCluster: 10
} as const;

function health(findings: Finding[]): "ok" | "warn" | "critical" {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "ok";
}

/**
 * Evaluate every rule over a snapshot. Order is stable (ops, then per-client
 * quality, then improvement) so the journal reads consistently.
 */
export function evaluateRules(snapshot: OperatorSnapshot): Finding[] {
  const findings: Finding[] = [];

  // --- Operations: the pipeline must be able to run at all -----------------

  // A dead Google token stops every sync. Nothing the Operator can safely do
  // about it - only a human can reconnect - so it always escalates.
  if (snapshot.google.needsReconnect) {
    findings.push({
      kind: "google-token-dead",
      severity: "critical",
      category: "ops",
      disposition: "escalate",
      clientId: null,
      summary: "The Google refresh token is no longer accepted; Search Console syncing has stopped.",
      recommendedAction:
        "Reconnect Google in Settings. If it keeps happening, set the OAuth app to 'In production' in Google Cloud Console (Testing mode expires tokens after 7 days)."
    });
  } else if (!snapshot.google.connected) {
    findings.push({
      kind: "google-not-connected",
      severity: "warn",
      category: "ops",
      disposition: "escalate",
      clientId: null,
      summary: "Google is not connected, so no Search Console data can sync.",
      recommendedAction: "Connect Google in Settings."
    });
  }

  // A free SERP provider running low. Escalate only when there is no cheaper
  // provider left after it in the chain to absorb the overflow.
  for (const [index, budget] of snapshot.providers.entries()) {
    if (budget.remaining === null || budget.monthlyFree === 0) {
      continue; // paid / no free tier - the ledger does not gate it
    }
    const fraction = budget.monthlyFree > 0 ? budget.remaining / budget.monthlyFree : 1;
    const hasFallbackAfter = snapshot.providers.slice(index + 1).length > 0;
    if (budget.remaining === 0) {
      findings.push({
        kind: "provider-quota-exhausted",
        severity: hasFallbackAfter ? "info" : "warn",
        category: "ops",
        disposition: hasFallbackAfter ? "suggestion" : "escalate",
        clientId: null,
        summary: `${budget.provider} has used its full free monthly quota (resets ${budget.resetsOn}).`,
        recommendedAction: hasFallbackAfter
          ? undefined
          : `Add a fallback provider or top up, or checks will be blocked until ${budget.resetsOn}.`
      });
    } else if (fraction <= RULE_THRESHOLDS.providerLowFraction) {
      findings.push({
        kind: "provider-quota-low",
        severity: "info",
        category: "ops",
        disposition: hasFallbackAfter ? "suggestion" : "escalate",
        clientId: null,
        summary: `${budget.provider} has ${budget.remaining} of ${budget.monthlyFree} free checks left this month.`,
        recommendedAction: hasFallbackAfter ? undefined : `Consider a top-up before ${budget.resetsOn}.`
      });
    }
  }

  // Stuck rows from a crash mid-run. The Operator can reconcile these itself.
  if (snapshot.stuckSyncRuns > 0 || snapshot.stuckInsights > 0) {
    findings.push({
      kind: "stuck-running-rows",
      severity: "warn",
      category: "ops",
      disposition: "auto",
      clientId: null,
      summary: `${snapshot.stuckSyncRuns} sync run(s) and ${snapshot.stuckInsights} report(s) are stuck "running" from an interrupted process.`
    });
  }

  // The database growing past retention pressure - a safe prune the Operator
  // performs itself (weekly rollups are preserved).
  if (snapshot.db.gscDailyRows > RULE_THRESHOLDS.dbRowsHigh) {
    findings.push({
      kind: "db-over-retention",
      severity: "info",
      category: "ops",
      disposition: "auto",
      clientId: null,
      summary: `gsc_daily holds ${snapshot.db.gscDailyRows.toLocaleString()} rows (${Math.round(snapshot.db.sizeBytes / 1_048_576)} MB); daily detail past ${rankConfig.gscRetentionDays} days can be pruned.`
    });
  }

  // --- Per-client operations + data quality --------------------------------

  for (const client of snapshot.clients) {
    if (!client.gscProperty) {
      findings.push({
        kind: "client-no-property",
        severity: "info",
        category: "ops",
        disposition: "suggestion",
        clientId: client.id,
        summary: `${client.name} has no Search Console property linked, so it has no data.`,
        recommendedAction: `Link a property for ${client.name} on its client page.`
      });
      continue;
    }

    // Repeated sync failures - a real, escalate-worthy operational fault.
    if (client.syncFailStreak >= RULE_THRESHOLDS.syncFailStreak) {
      findings.push({
        kind: "sync-failing-repeatedly",
        severity: "critical",
        category: "ops",
        disposition: "escalate",
        clientId: client.id,
        summary: `${client.name}'s Search Console sync has failed ${client.syncFailStreak} times in a row.`,
        recommendedAction: `Check the sync error for ${client.name} (Google permission on the property, or an API quota issue).`
      });
    } else if (client.syncFailStreak > 0) {
      // A single recent failure the Operator can simply retry.
      findings.push({
        kind: "sync-recently-failed",
        severity: "warn",
        category: "ops",
        disposition: "auto",
        clientId: client.id,
        summary: `${client.name}'s last Search Console sync failed; a retry is worth attempting.`
      });
    }

    // Stale data despite a healthy token usually means the schedule has not run
    // (machine asleep). Informational unless the token is fine and it is badly
    // behind.
    if (client.staleGscDays !== null && client.staleGscDays > RULE_THRESHOLDS.staleGscDays && snapshot.google.connected) {
      findings.push({
        kind: "gsc-data-stale",
        severity: "warn",
        category: "ops",
        disposition: "auto",
        clientId: client.id,
        summary: `${client.name}'s newest Search Console data is ${client.staleGscDays} days old; a sync will refresh it.`
      });
    }

    // A high block rate on live checks means the numbers cannot be trusted -
    // a data-quality escalation, since the fix (provider/config) is a decision.
    const totalChecks = client.checkHealth.ok + client.checkHealth.notFound + client.checkHealth.blocked + client.checkHealth.error;
    if (totalChecks >= 5 && client.blockedRate >= RULE_THRESHOLDS.blockedRate) {
      findings.push({
        kind: "keyword-block-rate-high",
        severity: "warn",
        category: "quality",
        disposition: "escalate",
        clientId: client.id,
        summary: `${client.name}: ${Math.round(client.blockedRate * 100)}% of recent rank checks were blocked or failed, so positions are unreliable.`,
        recommendedAction: `The SERP provider is struggling for ${client.name}. Consider switching the provider order or adding a paid fallback.`
      });
    }

    // --- Improvement lens: a real content/SEO opportunity worth a decision ---
    if (client.strikingDistanceCount >= RULE_THRESHOLDS.strikingDistanceCluster) {
      findings.push({
        kind: "striking-distance-cluster",
        severity: "info",
        category: "improvement",
        disposition: "suggestion",
        clientId: client.id,
        summary: `${client.name} has ${client.strikingDistanceCount} keywords in striking distance (real volume, just off page one) - a strong content opportunity.`,
        recommendedAction: `Review ${client.name}'s keyword suggestions; these are the fastest wins available.`
      });
    }
  }

  return findings;
}

export function summariseFindings(findings: Finding[]): {
  health: "ok" | "warn" | "critical";
  autoCount: number;
  escalateCount: number;
  suggestionCount: number;
} {
  return {
    health: health(findings),
    autoCount: findings.filter((f) => f.disposition === "auto").length,
    escalateCount: findings.filter((f) => f.disposition === "escalate").length,
    suggestionCount: findings.filter((f) => f.disposition === "suggestion").length
  };
}
