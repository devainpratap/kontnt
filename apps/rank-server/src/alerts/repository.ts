import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import type { AlertKind, AlertRecord } from "@rankos/shared";

import { db } from "../db/client";
import { alertsTable, keywordsTable } from "../db/schema";
import { todayInGscZone } from "../gsc/date-utils";
import type { AlertProposal } from "./rules";

/**
 * Persistence and de-duplication for alerts.
 *
 * The important behaviour beyond plain CRUD is de-duplication: a keyword may be
 * checked several times a day (a manual re-run, then the scheduler), and each
 * check re-evaluates the same transition. Without a guard the inbox would fill
 * with copies of one event. An alert is therefore unique per
 * (client, keyword, kind, day) - the same drop on the same day is recorded once.
 */

function nowIso() {
  return new Date().toISOString();
}

type AlertRow = typeof alertsTable.$inferSelect;

function toRecord(row: AlertRow): AlertRecord {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    clientId: row.clientId,
    keywordId: row.keywordId,
    kind: row.kind,
    detectedAt: row.detectedAt,
    delta: row.delta,
    payload,
    acknowledgedAt: row.acknowledgedAt
  };
}

export class AlertRepository {
  /**
   * Record proposals for one keyword, skipping any already raised today.
   * Returns the alerts actually created.
   */
  recordForKeyword(clientId: string, keywordId: string, proposals: AlertProposal[]): AlertRecord[] {
    if (proposals.length === 0) {
      return [];
    }

    const today = todayInGscZone();
    const created: AlertRecord[] = [];

    for (const proposal of proposals) {
      if (this.existsToday(clientId, keywordId, proposal.kind, today)) {
        continue;
      }

      const id = randomUUID();
      db.insert(alertsTable)
        .values({
          id,
          clientId,
          keywordId,
          kind: proposal.kind,
          detectedAt: nowIso(),
          delta: proposal.delta,
          payload: JSON.stringify(proposal.payload),
          acknowledgedAt: null
        })
        .run();

      const row = db.select().from(alertsTable).where(eq(alertsTable.id, id)).get();
      if (row) {
        created.push(toRecord(row));
      }
    }

    return created;
  }

  private existsToday(clientId: string, keywordId: string, kind: AlertKind, day: string): boolean {
    // "Today" is measured in the same zone as everything else so the dedupe
    // window lines up with a calendar day rather than a rolling 24h.
    const startOfDay = `${day}T00:00:00.000Z`;
    const row = db
      .select({ id: alertsTable.id })
      .from(alertsTable)
      .where(
        and(
          eq(alertsTable.clientId, clientId),
          eq(alertsTable.keywordId, keywordId),
          eq(alertsTable.kind, kind),
          gte(alertsTable.detectedAt, startOfDay)
        )
      )
      .get();
    return Boolean(row);
  }

  /** Alerts for a client, newest first; unacknowledged only by default. */
  listAlerts(clientId: string, options: { includeAcknowledged?: boolean; limit?: number } = {}): AlertRecord[] {
    const base = db
      .select()
      .from(alertsTable)
      .where(
        options.includeAcknowledged
          ? eq(alertsTable.clientId, clientId)
          : and(eq(alertsTable.clientId, clientId), isNull(alertsTable.acknowledgedAt))
      )
      .orderBy(desc(alertsTable.detectedAt))
      .limit(options.limit ?? 100);

    return base.all().map(toRecord);
  }

  /** Alerts joined to their keyword phrase, for the inbox display. */
  listWithKeyword(clientId: string, options: { includeAcknowledged?: boolean } = {}) {
    const rows = this.listAlerts(clientId, options);
    if (rows.length === 0) {
      return [];
    }

    const phrases = new Map<string, string>();
    for (const row of db.select({ id: keywordsTable.id, phrase: keywordsTable.phrase }).from(keywordsTable).all()) {
      phrases.set(row.id, row.phrase);
    }

    return rows.map((alert) => ({
      ...alert,
      phrase: alert.keywordId ? phrases.get(alert.keywordId) ?? null : null
    }));
  }

  unacknowledgedCount(clientId: string): number {
    const row = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(alertsTable)
      .where(and(eq(alertsTable.clientId, clientId), isNull(alertsTable.acknowledgedAt)))
      .get();
    return Number(row?.count ?? 0);
  }

  acknowledge(alertId: string): void {
    db.update(alertsTable).set({ acknowledgedAt: nowIso() }).where(eq(alertsTable.id, alertId)).run();
  }

  acknowledgeAll(clientId: string): number {
    const pending = this.listAlerts(clientId).length;
    db.update(alertsTable)
      .set({ acknowledgedAt: nowIso() })
      .where(and(eq(alertsTable.clientId, clientId), isNull(alertsTable.acknowledgedAt)))
      .run();
    return pending;
  }
}
