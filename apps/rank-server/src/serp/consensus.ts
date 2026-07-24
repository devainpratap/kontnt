import type { RankCheckStatus } from "@rankos/shared";

/**
 * Reconciling several readings of the same keyword into one honest answer.
 *
 * Free SERP providers route through rotating proxies, so the serving location
 * varies between requests. Measured live: "higher education seo" came back at
 * position 10, 6, 10 on three consecutive calls, because roughly one request in
 * three landed in a different region and Google served a different local SERP.
 *
 * A single reading therefore carries proxy noise that looks exactly like real
 * ranking movement - and "your position dropped four places" is precisely the
 * kind of claim that ends up in a client report. Consensus removes that: take
 * several readings, agree on the majority, and when they genuinely disagree,
 * store `blocked` (unknown) rather than a number we cannot stand behind. That
 * is the same rule the rest of the system follows - never a fabricated position.
 */

export type Reading = {
  status: Extract<RankCheckStatus, "ok" | "not-found" | "blocked" | "error">;
  /** Non-null only when status is "ok". */
  position: number | null;
  /** Which provider produced this reading, for attribution of the winner. */
  source?: string;
};

export type ConsensusResult = {
  status: RankCheckStatus;
  position: number | null;
  /** The source of the reading nearest the agreed position, when status is ok. */
  source: string | null;
  agreement: {
    attempts: number;
    /** Readings that actually observed the SERP (ok or not-found). */
    realReadings: number;
    okCount: number;
    notFoundCount: number;
    unknownCount: number;
    /** The ok positions seen, for the audit trail. */
    positions: number[];
    /** Max - min across ok positions. A large spread is a low-confidence signal. */
    spread: number;
  };
};

/** Median of a numeric list. Even-length lists average the two middle values. */
export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Resolve a set of readings.
 *
 * The logic, in order:
 *   1. Discard blocked/error - they observed nothing, so they cannot vote.
 *   2. If nothing observed the SERP at all, the answer is `blocked`.
 *   3. Otherwise majority rules between "ranked" and "not in the top N":
 *        - more ok than not-found  -> ok, position = median of the ok readings
 *        - more not-found than ok  -> not-found
 *        - a genuine tie           -> blocked (we truly do not know)
 *
 * The tie -> blocked case is deliberate. If one call says position 9 and another
 * says not-in-top-30, that is not a rank to average; it is a disagreement, and
 * the honest record is "unknown".
 */
export function resolveConsensus(readings: Reading[]): ConsensusResult {
  const real = readings.filter((r) => r.status === "ok" || r.status === "not-found");
  const okReadings = real.filter((r) => r.status === "ok" && r.position !== null);
  const notFoundCount = real.filter((r) => r.status === "not-found").length;
  const positions = okReadings.map((r) => r.position as number);

  const agreement = {
    attempts: readings.length,
    realReadings: real.length,
    okCount: okReadings.length,
    notFoundCount,
    unknownCount: readings.length - real.length,
    positions,
    spread: positions.length > 0 ? Math.max(...positions) - Math.min(...positions) : 0
  };

  // Nothing observed the SERP - genuinely unknown, never a position.
  if (real.length === 0) {
    return { status: "blocked", position: null, source: null, agreement };
  }

  // Majority ranked the client somewhere.
  if (okReadings.length > notFoundCount) {
    const agreed = median(positions);
    // Attribute to the reading closest to the agreed position.
    const winner = okReadings.reduce((best, current) =>
      Math.abs((current.position as number) - agreed) < Math.abs((best.position as number) - agreed)
        ? current
        : best
    );
    return { status: "ok", position: agreed, source: winner.source ?? null, agreement };
  }

  // Majority saw the client nowhere in range.
  if (notFoundCount > okReadings.length) {
    return { status: "not-found", position: null, source: null, agreement };
  }

  // A dead tie between "ranked" and "not found" - we do not know.
  return { status: "blocked", position: null, source: null, agreement };
}
