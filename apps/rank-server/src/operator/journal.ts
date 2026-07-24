import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { desc, eq } from "drizzle-orm";

import { readTextFile, writeMarkdownFile } from "../clients/files";
import { rankConfig } from "../config";
import { db } from "../db/client";
import { operatorRunsTable } from "../db/schema";
import type { Finding } from "./rules";

/**
 * The Operator's memory. Two layers:
 *  - a per-run journal entry on disk (the human-readable record of what was
 *    seen, decided, and done), and
 *  - an operator_runs index row so runs are listable and escalations trackable.
 *
 * Files on disk are the record; the table indexes them - the same
 * files-as-source-of-truth pattern the rest of RankOS uses.
 */

const OPERATOR_DIR = () => join(rankConfig.dataRoot, "operator");
const JOURNAL_DIR = () => join(OPERATOR_DIR(), "journal");
/** Durable, append-only learnings that carry across runs ("improves over time"). */
const NOTES_PATH = () => join(OPERATOR_DIR(), "notes.md");

export type Escalation = {
  kind: string;
  summary: string;
  recommendedAction: string | null;
  clientId: string | null;
};

export type OperatorRunRecord = {
  id: string;
  ranAt: string;
  healthLevel: string;
  findingsCount: number;
  actionsCount: number;
  escalationsCount: number;
  escalations: Escalation[];
  acknowledgedAt: string | null;
  summary: string;
  journalPath: string | null;
};

type Row = typeof operatorRunsTable.$inferSelect;

function toRecord(row: Row): OperatorRunRecord {
  let escalations: Escalation[] = [];
  try {
    escalations = JSON.parse(row.escalations) as Escalation[];
  } catch {
    escalations = [];
  }
  return {
    id: row.id,
    ranAt: row.ranAt,
    healthLevel: row.healthLevel,
    findingsCount: row.findingsCount,
    actionsCount: row.actionsCount,
    escalationsCount: row.escalationsCount,
    escalations,
    acknowledgedAt: row.acknowledgedAt,
    summary: row.summary,
    journalPath: row.journalPath
  };
}

export type RecordRunInput = {
  ranAt: string;
  healthLevel: "ok" | "warn" | "critical";
  findings: Finding[];
  /** Human-readable lines describing each auto-action taken. */
  actions: string[];
  escalations: Escalation[];
  summary: string;
  /** The full journal body (rendered by the service). */
  journalBody: string;
};

export class OperatorJournal {
  /** Write the journal entry to disk and index the run. Returns the record. */
  async recordRun(input: RecordRunInput): Promise<OperatorRunRecord> {
    await mkdir(JOURNAL_DIR(), { recursive: true });

    const id = randomUUID();
    const fileStamp = input.ranAt.replace(/[:.]/g, "-");
    const journalPath = join(JOURNAL_DIR(), `${fileStamp}.md`);

    // A snapshot failure or disk issue must not lose the run index.
    let savedPath: string | null = journalPath;
    try {
      await writeMarkdownFile(journalPath, input.journalBody);
    } catch {
      savedPath = null;
    }

    db.insert(operatorRunsTable)
      .values({
        id,
        ranAt: input.ranAt,
        healthLevel: input.healthLevel,
        findingsCount: input.findings.length,
        actionsCount: input.actions.length,
        escalationsCount: input.escalations.length,
        escalations: JSON.stringify(input.escalations),
        acknowledgedAt: input.escalations.length === 0 ? input.ranAt : null,
        summary: input.summary,
        journalPath: savedPath
      })
      .run();

    return this.getRun(id) as OperatorRunRecord;
  }

  getRun(id: string): OperatorRunRecord | null {
    const row = db.select().from(operatorRunsTable).where(eq(operatorRunsTable.id, id)).get();
    return row ? toRecord(row) : null;
  }

  listRuns(limit = 30): OperatorRunRecord[] {
    return db
      .select()
      .from(operatorRunsTable)
      .orderBy(desc(operatorRunsTable.ranAt))
      .limit(limit)
      .all()
      .map(toRecord);
  }

  latestRun(): OperatorRunRecord | null {
    const row = db.select().from(operatorRunsTable).orderBy(desc(operatorRunsTable.ranAt)).limit(1).get();
    return row ? toRecord(row) : null;
  }

  /** Runs that still have open (unacknowledged) escalations. */
  openEscalations(): OperatorRunRecord[] {
    return this.listRuns(50).filter((run) => run.escalations.length > 0 && !run.acknowledgedAt);
  }

  acknowledge(runId: string): void {
    db.update(operatorRunsTable)
      .set({ acknowledgedAt: new Date().toISOString() })
      .where(eq(operatorRunsTable.id, runId))
      .run();
  }

  async readJournal(runId: string): Promise<string | null> {
    const run = this.getRun(runId);
    return run?.journalPath ? readTextFile(run.journalPath) : null;
  }

  // --- durable notes (carried across runs) ---------------------------------

  async readNotes(): Promise<string> {
    return (await readTextFile(NOTES_PATH())) ?? "";
  }

  /** Append a dated learning. Idempotent-ish: skips an identical last line. */
  async appendNote(note: string): Promise<void> {
    await mkdir(OPERATOR_DIR(), { recursive: true });
    const existing = await this.readNotes();
    const line = `- ${note.trim()}`;
    if (existing.trimEnd().endsWith(line)) {
      return;
    }
    await writeMarkdownFile(NOTES_PATH(), existing ? `${existing.trimEnd()}\n${line}` : `# Operator notes\n\n${line}`);
  }
}
