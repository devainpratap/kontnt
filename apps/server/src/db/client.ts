import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { appConfig } from "../config";

const sqlite = new Database(appConfig.dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Generated SQL migrations live next to the compiled/source tree at
// apps/server/drizzle. This module is apps/server/src/db/client.ts, so the
// folder is two levels up. Resolving via import.meta.url keeps it correct
// under tsx (dev + Docker `dev:server`) regardless of the process cwd.
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

function tableExists(name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

/**
 * Bring a pre-existing (pre-migrations) database under Drizzle's migration
 * control without re-running the baseline CREATE TABLE statements. Earlier
 * builds created the tables with a hand-written `CREATE TABLE IF NOT EXISTS`
 * block and never recorded a migration, so a populated production DB has the
 * tables but no `__drizzle_migrations` bookkeeping table.
 *
 * The Drizzle sqlite migrator decides what to apply purely by comparing the
 * `created_at` of the most recently recorded migration against each pending
 * migration's folder timestamp (see sqlite-core dialect `migrate`). So we
 * "stamp" the 0000 baseline as already applied by inserting its folder
 * timestamp. migrate() then skips 0000 (whose CREATE TABLE would otherwise
 * throw against existing tables) and applies only newer migrations — leaving
 * the existing rows untouched.
 *
 * Fresh databases have no `jobs` table, so this is a no-op and migrate() runs
 * every migration from scratch.
 */
function stampBaselineIfLegacy(): void {
  const isLegacy = tableExists("jobs") && !tableExists("__drizzle_migrations");
  if (!isLegacy) {
    return;
  }

  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    return;
  }

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries?: Array<{ idx: number; when: number; tag: string }>;
  };
  const baseline = journal.entries?.find((entry) => entry.idx === 0);
  if (!baseline) {
    return;
  }

  // Mirror the migrator's bookkeeping table (id/hash/created_at). Only the
  // created_at value is load-bearing; hash is informational.
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)"
  );
  const existing = sqlite
    .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
    .get() as { count: number };
  if (existing.count > 0) {
    return;
  }
  sqlite
    .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run(`baseline:${baseline.tag}`, baseline.when);
}

export function initializeDatabase(): void {
  // schema.ts is the single source of truth; the physical DB is brought up to
  // date from the generated SQL migrations on boot. Idempotent and safe to run
  // against an already-migrated or freshly-baselined database.
  stampBaselineIfLegacy();
  migrate(db, { migrationsFolder });
}
