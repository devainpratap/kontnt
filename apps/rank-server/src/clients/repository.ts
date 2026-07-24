import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type {
  ClientRecord,
  ClientSummary,
  CreateClientInput,
  GscPropertyType,
  UpdateClientInput
} from "@rankos/shared";

import { rankConfig } from "../config";
import { db } from "../db/client";
import { alertsTable, clientsTable, keywordsTable, rankChecksTable, syncRunsTable } from "../db/schema";
import { ApiError } from "../lib/api-error";
import {
  assertWithinClientsRoot,
  buildClientPaths,
  ensureClientDirs,
  slugifyClientName,
  writeJsonFile,
  type ClientPaths
} from "./files";

function nowIso() {
  return new Date().toISOString();
}

/** Domain properties are `sc-domain:example.com`; anything else is a URL prefix. */
function detectPropertyType(gscProperty: string | null | undefined): GscPropertyType | null {
  if (!gscProperty) {
    return null;
  }
  return gscProperty.startsWith("sc-domain:") ? "domain" : "url-prefix";
}

type ClientRow = typeof clientsTable.$inferSelect;

function toRecord(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    primaryDomain: row.primaryDomain,
    gscProperty: row.gscProperty,
    gscPropertyType: row.gscPropertyType,
    // Stored as a JSON string; a malformed value must not take down the list
    // page, so fall back to empty rather than throwing.
    brandTerms: safeParseStringArray(row.brandTerms),
    notes: row.notes,
    clientPath: row.clientPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt
  };
}

function safeParseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export class ClientRepository {
  /**
   * Slugs are unique because they become folder names. Append a numeric suffix
   * rather than failing, so "Acme" and "ACME!" can both exist.
   */
  private allocateSlug(name: string): string {
    const base = slugifyClientName(name);
    let candidate = base;
    let counter = 2;

    while (db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.slug, candidate)).get()) {
      candidate = `${base}-${counter}`;
      counter += 1;
    }

    return candidate;
  }

  async createClient(input: CreateClientInput): Promise<ClientRecord> {
    const id = randomUUID();
    const slug = this.allocateSlug(input.name);
    const clientPath = assertWithinClientsRoot(join(rankConfig.clientsRoot, `${slug}-${id.slice(0, 8)}`));
    const createdAt = nowIso();

    await mkdir(clientPath, { recursive: true });
    const paths = buildClientPaths(clientPath);
    await ensureClientDirs(paths);

    db.insert(clientsTable)
      .values({
        id,
        name: input.name,
        slug,
        primaryDomain: input.primaryDomain,
        gscProperty: input.gscProperty ?? null,
        gscPropertyType: detectPropertyType(input.gscProperty),
        brandTerms: JSON.stringify(input.brandTerms),
        notes: input.notes,
        clientPath,
        createdAt,
        updatedAt: createdAt,
        archivedAt: null
      })
      .run();

    const record = this.getClientOrThrow(id);
    // Files on disk are the source of truth; the DB row is an index. Writing
    // client.json means the database can be deleted and rebuilt from clients/.
    await writeJsonFile(paths.clientFile, record);
    return record;
  }

  getClient(clientId: string): ClientRecord | null {
    const row = db.select().from(clientsTable).where(eq(clientsTable.id, clientId)).get();
    return row ? toRecord(row) : null;
  }

  getClientOrThrow(clientId: string): ClientRecord {
    const client = this.getClient(clientId);
    if (!client) {
      throw new ApiError(`Client not found: ${clientId}`, 404, "CLIENT_NOT_FOUND");
    }
    return client;
  }

  /**
   * List with the roll-ups the client list page needs.
   *
   * Aggregates are fetched as four grouped queries and merged in memory rather
   * than as per-client subqueries, so the cost stays flat as clients are added
   * instead of growing N+1.
   */
  listClients(options: { includeArchived?: boolean } = {}): ClientSummary[] {
    const base = db.select().from(clientsTable);
    const rows = options.includeArchived
      ? base.orderBy(desc(clientsTable.updatedAt)).all()
      : base.where(isNull(clientsTable.archivedAt)).orderBy(desc(clientsTable.updatedAt)).all();

    if (rows.length === 0) {
      return [];
    }

    const keywordCounts = new Map<string, { total: number; active: number }>();
    for (const entry of db
      .select({
        clientId: keywordsTable.clientId,
        total: sql<number>`COUNT(*)`,
        active: sql<number>`SUM(CASE WHEN ${keywordsTable.isActive} = 1 THEN 1 ELSE 0 END)`
      })
      .from(keywordsTable)
      .groupBy(keywordsTable.clientId)
      .all()) {
      keywordCounts.set(entry.clientId, {
        total: Number(entry.total ?? 0),
        active: Number(entry.active ?? 0)
      });
    }

    const alertCounts = new Map<string, number>();
    for (const entry of db
      .select({ clientId: alertsTable.clientId, total: sql<number>`COUNT(*)` })
      .from(alertsTable)
      .where(isNull(alertsTable.acknowledgedAt))
      .groupBy(alertsTable.clientId)
      .all()) {
      alertCounts.set(entry.clientId, Number(entry.total ?? 0));
    }

    const lastGscSync = new Map<string, string>();
    for (const entry of db
      .select({ clientId: syncRunsTable.clientId, lastAt: sql<string | null>`MAX(${syncRunsTable.completedAt})` })
      .from(syncRunsTable)
      .where(
        and(
          eq(syncRunsTable.status, "completed"),
          inArray(syncRunsTable.kind, ["gsc-sync", "gsc-backfill"])
        )
      )
      .groupBy(syncRunsTable.clientId)
      .all()) {
      if (entry.clientId && entry.lastAt) {
        lastGscSync.set(entry.clientId, entry.lastAt);
      }
    }

    // Only "ok" checks count as a real check. A blocked or failed scrape must
    // never make the dashboard look freshly updated.
    const lastSerpCheck = new Map<string, string>();
    for (const entry of db
      .select({ clientId: keywordsTable.clientId, lastAt: sql<string | null>`MAX(${rankChecksTable.checkedAt})` })
      .from(rankChecksTable)
      .innerJoin(keywordsTable, eq(keywordsTable.id, rankChecksTable.keywordId))
      .where(eq(rankChecksTable.status, "ok"))
      .groupBy(keywordsTable.clientId)
      .all()) {
      if (entry.lastAt) {
        lastSerpCheck.set(entry.clientId, entry.lastAt);
      }
    }

    return rows.map((row) => {
      const keywords = keywordCounts.get(row.id);
      return {
        ...toRecord(row),
        keywordCount: keywords?.total ?? 0,
        activeKeywordCount: keywords?.active ?? 0,
        unacknowledgedAlertCount: alertCounts.get(row.id) ?? 0,
        lastGscSyncAt: lastGscSync.get(row.id) ?? null,
        lastSerpCheckAt: lastSerpCheck.get(row.id) ?? null
      };
    });
  }

  async updateClient(clientId: string, input: UpdateClientInput): Promise<ClientRecord> {
    const existing = this.getClientOrThrow(clientId);

    const patch: Partial<typeof clientsTable.$inferInsert> = { updatedAt: nowIso() };

    if (input.name !== undefined) patch.name = input.name;
    if (input.primaryDomain !== undefined) patch.primaryDomain = input.primaryDomain;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.brandTerms !== undefined) patch.brandTerms = JSON.stringify(input.brandTerms);
    if (input.gscProperty !== undefined) {
      patch.gscProperty = input.gscProperty ?? null;
      patch.gscPropertyType = detectPropertyType(input.gscProperty);
    }
    if (input.archived !== undefined) {
      // Archive rather than delete: keyword history and GSC data stay intact.
      patch.archivedAt = input.archived ? (existing.archivedAt ?? nowIso()) : null;
    }

    db.update(clientsTable).set(patch).where(eq(clientsTable.id, clientId)).run();

    const record = this.getClientOrThrow(clientId);
    await writeJsonFile(buildClientPaths(record.clientPath).clientFile, record);
    return record;
  }

  getClientPaths(clientId: string): ClientPaths {
    const client = this.getClientOrThrow(clientId);
    return buildClientPaths(assertWithinClientsRoot(client.clientPath));
  }

  /**
   * Boot-time cleanup for runs left "running" when the server died mid-sync.
   * Such rows would otherwise block the in-flight lock forever.
   */
  reconcileInterruptedRuns(): number {
    const timestamp = nowIso();

    const interrupted = db
      .select({ id: syncRunsTable.id })
      .from(syncRunsTable)
      .where(eq(syncRunsTable.status, "running"))
      .all();

    if (interrupted.length === 0) {
      return 0;
    }

    db.update(syncRunsTable)
      .set({
        status: "failed",
        errorMessage: "Interrupted by server restart",
        completedAt: timestamp
      })
      .where(and(eq(syncRunsTable.status, "running")))
      .run();

    return interrupted.length;
  }
}
