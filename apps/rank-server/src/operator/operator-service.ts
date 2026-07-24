import { rankConfig } from "../config";
import { runOperatorReasoning } from "../insights/claude-runner";
import { isEmailConfigured, sendOperatorEmail } from "../notify/email";
import { OperatorJournal, type Escalation, type OperatorRunRecord } from "./journal";
import { remediate } from "./remediation";
import { evaluateRules, summariseFindings, type Finding } from "./rules";
import { gatherSnapshot, type OperatorSnapshot } from "./snapshot";

/**
 * The Operator: RankOS's supervised operations brain.
 *
 * One run is a deterministic pipeline - gather a health snapshot, evaluate the
 * rules, (Phase B) fix the safe things, collect what needs a human, and record
 * a journal entry. The LLM reasoning pass (Phase C) only writes language over
 * the already-decided facts; it is never in the action path.
 *
 * Phase A (this file for now) does observe + record + escalate. The remediation
 * and reasoning seams are marked so later phases slot in without reshaping the
 * run.
 */

export type OperatorRunResult = {
  record: OperatorRunRecord;
  snapshot: OperatorSnapshot;
  findings: Finding[];
};

function badge(f: Finding): string {
  const sev = f.severity === "critical" ? "🔴" : f.severity === "warn" ? "🟡" : "🔵";
  return `${sev} **${f.kind}** — ${f.summary}`;
}

function renderJournal(
  snapshot: OperatorSnapshot,
  findings: Finding[],
  actions: string[],
  escalations: Escalation[]
): string {
  const summary = summariseFindings(findings);
  const section = (title: string, items: string[]) =>
    items.length ? `## ${title}\n\n${items.join("\n")}\n` : "";

  const byDisposition = (d: Finding["disposition"]) => findings.filter((f) => f.disposition === d).map(badge);

  return [
    `# Operator run — ${snapshot.takenAt}`,
    "",
    `Health: **${summary.health.toUpperCase()}** · ${findings.length} finding(s) · ` +
      `${actions.length} auto-action(s) · ${escalations.length} escalation(s)`,
    "",
    section("Fixed automatically", actions.map((a) => `✅ ${a}`)),
    section("Needs you", byDisposition("escalate")),
    section("Auto-fixable (pending)", byDisposition("auto")),
    section("Suggestions", byDisposition("suggestion")),
    "## System snapshot",
    "",
    `- Google: ${snapshot.google.connected ? (snapshot.google.needsReconnect ? "needs reconnect" : "connected") : "not connected"}`,
    `- Providers: ${snapshot.providers.map((p) => `${p.provider} ${p.remaining === null ? "(paid)" : `${p.remaining}/${p.monthlyFree}`}`).join(", ")}`,
    `- Database: ${Math.round(snapshot.db.sizeBytes / 1_048_576)} MB, ${snapshot.db.gscDailyRows.toLocaleString()} daily rows`,
    `- Email: ${snapshot.email.enabled && snapshot.email.configured ? `on → ${snapshot.email.to}` : "off"}`,
    `- Clients: ${snapshot.clients.length} (${snapshot.clients.filter((c) => c.gscProperty).length} linked)`,
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Compact prompt for the reasoning pass - facts only, no raw rows. */
function buildReasoningPrompt(
  snapshot: OperatorSnapshot,
  findings: Finding[],
  actions: string[],
  escalations: Escalation[],
  notes: string
): string {
  return [
    "System health snapshot and findings for a RankOS operations run.",
    "",
    `Health: ${summariseFindings(findings).health}. Clients: ${snapshot.clients.length}. ` +
      `DB: ${Math.round(snapshot.db.sizeBytes / 1_048_576)}MB. ` +
      `Google: ${snapshot.google.connected ? (snapshot.google.needsReconnect ? "needs reconnect" : "ok") : "not connected"}.`,
    "",
    "Findings:",
    ...findings.map((f) => `- [${f.disposition}/${f.severity}] ${f.kind}: ${f.summary}`),
    "",
    actions.length ? `Auto-fixed this run:
${actions.map((a) => `- ${a}`).join("\n")}` : "Nothing auto-fixed this run.",
    "",
    escalations.length ? `Escalated to the operator: ${escalations.length} item(s).` : "Nothing escalated.",
    "",
    notes ? `Prior learnings:\n${notes}` : "No prior learnings recorded."
  ].join("\n");
}

/** Split the reasoning output into the log paragraph and an optional NOTE line. */
function splitReasoning(text: string): { read: string; note: string | null } {
  const match = text.match(/^NOTE:\s*(.+)$/im);
  const note = match ? match[1].trim() : null;
  const read = text.replace(/^NOTE:.*$/im, "").trim();
  return { read, note };
}

export class OperatorService {
  constructor(private readonly journal = new OperatorJournal()) {}

  /**
   * Run the Operator once.
   *
   * `apply` gates the safe auto-remediations. false = observe & recommend only
   * (the escalate/auto findings are still listed, nothing is executed).
   */
  async run(options: { apply?: boolean; now?: Date } = {}): Promise<OperatorRunResult> {
    const now = options.now ?? new Date();
    const snapshot = gatherSnapshot(now);
    const findings = evaluateRules(snapshot);
    const summary = summariseFindings(findings);

    // --- Safe auto-remediation --------------------------------------------
    // Only findings marked "auto" are eligible, and remediate() itself refuses
    // anything not on its hardcoded allowlist - two independent gates. Skipped
    // entirely when apply is false (observe & recommend mode).
    const actions: string[] = [];
    const failedAutoFixes: Finding[] = [];

    if (options.apply !== false) {
      for (const finding of findings.filter((f) => f.disposition === "auto")) {
        const result = await remediate(finding);
        if (!result) {
          continue;
        }
        actions.push(result.description);
        if (!result.ok) {
          // The safe fix could not resolve it - hand it to the operator.
          failedAutoFixes.push(finding);
        }
      }
    }

    // Anything the operator must handle personally: rules that escalate by
    // design, plus any auto-fix that failed.
    const escalations: Escalation[] = [
      ...findings.filter((f) => f.disposition === "escalate"),
      ...failedAutoFixes
    ].map((f) => ({
      kind: f.kind,
      summary: f.summary,
      recommendedAction: f.recommendedAction ?? null,
      clientId: f.clientId
    }));

    // --- Reasoning pass (language only, best-effort, never actions) --------
    // Claude reads the already-decided facts and writes a plain-language read,
    // and may propose one durable note. It cannot change actions or escalations.
    let operatorRead = "";
    if (findings.length > 0) {
      try {
        const notes = await this.journal.readNotes();
        const reasoning = await runOperatorReasoning(
          buildReasoningPrompt(snapshot, findings, actions, escalations, notes)
        );
        const { read, note } = splitReasoning(reasoning);
        operatorRead = read;
        if (note) {
          await this.journal.appendNote(`${now.toISOString().slice(0, 10)}: ${note}`);
        }
      } catch {
        // Claude unavailable - the deterministic journal stands on its own.
      }
    }

    const journalBody =
      (operatorRead ? `> ${operatorRead.replace(/\n/g, "\n> ")}\n\n` : "") +
      renderJournal(snapshot, findings, actions, escalations);

    const record = await this.journal.recordRun({
      ranAt: now.toISOString(),
      healthLevel: summary.health,
      findings,
      actions,
      escalations,
      summary:
        findings.length === 0
          ? "All clear — no issues found."
          : `${summary.health.toUpperCase()}: ${escalations.length} need you, ${actions.length} auto-fixed, ${summary.suggestionCount} suggestion(s).`,
      journalBody
    });

    // --- Escalate by email, only when a human is actually needed ----------
    if (options.apply !== false && escalations.length > 0 && rankConfig.emailEnabled && isEmailConfigured()) {
      try {
        const body = [
          operatorRead ? `${operatorRead}\n` : "",
          "## What needs you\n",
          ...escalations.map((e) => `- **${e.summary}**${e.recommendedAction ? `\n  ${e.recommendedAction}` : ""}`),
          actions.length ? `\n## Already fixed automatically\n\n${actions.map((a) => `- ${a}`).join("\n")}` : ""
        ]
          .filter(Boolean)
          .join("\n");
        await sendOperatorEmail(`RankOS Operator: ${escalations.length} item(s) need you`, body);
      } catch (error) {
        console.error("[operator] escalation email failed:", error instanceof Error ? error.message : error);
      }
    }

    return { record, snapshot, findings };
  }

  getJournal(): OperatorJournal {
    return this.journal;
  }
}
