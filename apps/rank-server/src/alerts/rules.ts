import type { AlertKind } from "@rankos/shared";

/**
 * Deterministic alert rules over rank-check transitions.
 *
 * The point of alerts is to learn about a ranking change from the app rather
 * than from the client. But an alert on bad data is worse than no alert, so the
 * one inviolable rule here mirrors the rest of the system: **only two real
 * readings can be compared.** A blocked or errored check is unknown, and a move
 * "from position 4 to unknown" is not a drop - it is an absence of information.
 * Comparing against it would fire false alarms every time the scraper hiccups.
 */

export type Reading =
  | { kind: "ranked"; position: number }
  | { kind: "not-found" }
  | { kind: "unknown" }; // blocked or errored - carries no information

export type AlertProposal = {
  kind: AlertKind;
  /** Signed position change where meaningful (negative = improved). */
  delta: number | null;
  payload: Record<string, unknown>;
};

export type AlertThresholds = {
  /** Minimum absolute position change to raise a "large move". */
  largeMove: number;
};

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  largeMove: 5
};

/**
 * Convert a stored rank check into a reading.
 *
 * "not-found" is a real observation (the client genuinely was not in the
 * fetched depth); "blocked"/"error" are non-observations and become "unknown".
 */
export function toReading(status: string, position: number | null): Reading {
  if (status === "ok" && position !== null) {
    return { kind: "ranked", position };
  }
  if (status === "not-found") {
    return { kind: "not-found" };
  }
  return { kind: "unknown" };
}

/** A not-found reading is treated as this rank for threshold comparisons. */
const BEYOND_DEPTH = 101;

function rankValue(reading: Reading): number | null {
  if (reading.kind === "ranked") {
    return reading.position;
  }
  if (reading.kind === "not-found") {
    return BEYOND_DEPTH;
  }
  return null; // unknown - never comparable
}

/**
 * Propose alerts for a single keyword's transition between two checks.
 *
 * Returns an empty list whenever either side is unknown, so a scraper failure
 * can never raise an alert. The caller persists and de-duplicates.
 */
export function evaluateTransition(
  previous: Reading,
  current: Reading,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS
): AlertProposal[] {
  const before = rankValue(previous);
  const after = rankValue(current);

  // Either side unknown -> we do not know if anything changed. Say nothing.
  if (before === null || after === null) {
    return [];
  }

  const proposals: AlertProposal[] = [];
  const wasInTop3 = before <= 3;
  const isInTop3 = after <= 3;
  const wasInTop10 = before <= 10;
  const isInTop10 = after <= 10;

  const payload = {
    previousPosition: previous.kind === "ranked" ? previous.position : null,
    currentPosition: current.kind === "ranked" ? current.position : null,
    previousNotFound: previous.kind === "not-found",
    currentNotFound: current.kind === "not-found"
  };

  // Entered the top 3 - a genuine win worth surfacing immediately.
  if (!wasInTop3 && isInTop3) {
    proposals.push({ kind: "entered-top-3", delta: after - before, payload });
  }

  // Fell out of the top 3 (but is still ranked somewhere in reach).
  if (wasInTop3 && !isInTop3) {
    proposals.push({ kind: "dropped-out-of-top-3", delta: after - before, payload });
  }

  // Fell off page one entirely - the click-losing event that matters most.
  if (wasInTop10 && !isInTop10) {
    proposals.push({ kind: "dropped-out-of-top-10", delta: after - before, payload });
  }

  // A large move in either direction, when both readings are real ranks (a
  // not-found edge is already covered by the top-3/top-10 rules above and would
  // otherwise double-fire off the BEYOND_DEPTH sentinel).
  if (previous.kind === "ranked" && current.kind === "ranked") {
    const move = current.position - previous.position;
    if (Math.abs(move) >= thresholds.largeMove) {
      // Suppress when a more specific top-3/top-10 alert already describes it,
      // to avoid two notifications for one event.
      const alreadyDescribed =
        proposals.some((p) => p.kind === "dropped-out-of-top-3" || p.kind === "dropped-out-of-top-10") &&
        move > 0;
      if (!alreadyDescribed) {
        proposals.push({ kind: "large-move", delta: move, payload });
      }
    }
  }

  return proposals;
}

/**
 * The competitor rule: a domain newly present in the top 3 that was not there
 * last time. Pure over the two domain lists so it is testable without a fetch.
 */
export function evaluateNewCompetitors(
  previousTop3: string[],
  currentTop3: string[],
  clientDomain: string
): AlertProposal[] {
  const before = new Set(previousTop3.map((d) => d.toLowerCase()));
  const client = clientDomain.toLowerCase();

  const newcomers = currentTop3
    .map((d) => d.toLowerCase())
    .filter((domain) => domain !== client && !before.has(domain));

  if (newcomers.length === 0) {
    return [];
  }

  return newcomers.map((domain) => ({
    kind: "new-competitor-top-3" as AlertKind,
    delta: null,
    payload: { competitor: domain }
  }));
}

/** Human-readable one-liner for an alert, used in the inbox and notifications. */
export function describeAlert(kind: AlertKind, payload: Record<string, unknown>, phrase?: string): string {
  const label = phrase ? `"${phrase}"` : "A keyword";
  const prev = payload.previousPosition as number | null;
  const cur = payload.currentPosition as number | null;
  const move = prev !== null && cur !== null ? `${prev} to ${cur}` : null;

  switch (kind) {
    case "entered-top-3":
      return `${label} entered the top 3${move ? ` (${move})` : ""}.`;
    case "dropped-out-of-top-3":
      return `${label} dropped out of the top 3${move ? ` (${move})` : ""}.`;
    case "dropped-out-of-top-10":
      return `${label} dropped off page one${payload.currentNotFound ? " (no longer in the top 100)" : move ? ` (${move})` : ""}.`;
    case "large-move":
      return `${label} moved sharply${move ? ` (${move})` : ""}.`;
    case "page-lost-clicks":
      return `A page lost most of its clicks this week.`;
    case "new-competitor-top-3":
      return `New competitor in the top 3: ${payload.competitor as string}.`;
    default:
      return `${label} changed.`;
  }
}
