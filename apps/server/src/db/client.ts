import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { appConfig } from "../config";

const sqlite = new Database(appConfig.dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export function initializeDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      job_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_steps (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt_path TEXT,
      output_path TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT
    );
  `);
}

