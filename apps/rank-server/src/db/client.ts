import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { rankConfig } from "../config";

// better-sqlite3 refuses to create the file if its directory is missing, and
// this module opens the database at import time — before any async setup can
// run. Creating the directory here makes a fresh clone boot on the first try.
mkdirSync(dirname(rankConfig.dbPath), { recursive: true });

const sqlite = new Database(rankConfig.dbPath);
sqlite.pragma("journal_mode = WAL");
// gsc_daily grows to millions of rows; foreign-key-free but index-heavy reads
// benefit from a larger page cache than the 2MB default.
sqlite.pragma("cache_size = -64000");

export const db = drizzle(sqlite);

// Generated SQL migrations live at apps/rank-server/drizzle. This module is
// apps/rank-server/src/db/client.ts, so the folder is two levels up. Resolving
// via import.meta.url keeps it correct under tsx regardless of process cwd.
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle");

/**
 * Bring the physical database up to date from the generated migrations.
 * Unlike ContentOS this database has no pre-migrations legacy state to
 * baseline-stamp, so this is a plain migrate() on every boot. Idempotent.
 */
export function initializeRankDatabase(): void {
  migrate(db, { migrationsFolder });
}
