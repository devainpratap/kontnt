// Deterministic fleet/trucking/telematics/logistics topic detection shared by the
// style audit (Matrack pitch/capability detectors) and the prompt loader (whether to
// inject Matrack quality rules). Keep this simple and keyword-driven so the same
// article is scoped identically on both sides.

// Distinctive fleet-domain terms. A single strong match is enough to scope an
// article into the fleet/trucking/telematics/logistics domain. These terms are
// specific enough that they rarely appear in unrelated topics.
const strongFleetPatterns: RegExp[] = [
  /\bmatrack\b/i,
  /\bfleets?\b/i,
  /\btelematics?\b/i,
  /\btrucking\b/i,
  /\btrucks?\b/i,
  /\bsemi-?trucks?\b/i,
  /\bdash-?cams?\b/i,
  /\beld\b/i,
  /\bfmcsa\b/i,
  /\bdot\s+(?:compliance|regulation|number|inspection|requirements?)\b/i,
  /\bhours of service\b/i,
  /\bgps\s+(?:tracking|fleet)\b/i,
  /\bvehicle tracking\b/i,
  /\basset tracking\b/i,
  /\bgeofenc\w*/i,
  /\bfuel management\b/i,
  /\bfreight\b/i,
  /\bdispatch\w*/i,
  /\blogistics?\b/i,
  /\bowner[-\s]operators?\b/i,
  /\bcarriers?\b/i,
  /\bshippers?\b/i,
  /\bbroker\w*/i,
  /\bodometer\b/i,
  /\bidling?\b/i,
  /\btelemetry\b/i
];

// Weaker, more generic signals. On their own any one of these can appear in an
// unrelated article, so require at least two distinct weak matches to scope fleet.
const weakFleetPatterns: RegExp[] = [
  /\bgps\b/i,
  /\bdrivers?\b/i,
  /\bvehicles?\b/i,
  /\broutes?\b/i,
  /\bmaintenance alerts?\b/i,
  /\bcompliance\b/i,
  /\bcargo\b/i,
  /\bwarehouse\b/i
];

/**
 * Decide whether the supplied text describes a fleet/trucking/telematics/logistics
 * topic. Accepts any concatenation of available signals (markdown body, article
 * brief, target keyword, entities, etc.).
 */
export function isFleetTopic(...signals: Array<string | null | undefined>): boolean {
  const text = signals.filter(Boolean).join("\n");
  if (!text.trim()) {
    return false;
  }

  if (strongFleetPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  const weakMatches = weakFleetPatterns.filter((pattern) => pattern.test(text)).length;
  return weakMatches >= 2;
}
