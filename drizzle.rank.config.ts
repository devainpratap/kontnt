import { defineConfig } from "drizzle-kit";

// RankOS keeps its own schema, migrations folder, and database file so it can
// never migrate or corrupt the ContentOS database. See drizzle.config.ts for
// the ContentOS equivalent.
export default defineConfig({
  schema: "./apps/rank-server/src/db/schema.ts",
  out: "./apps/rank-server/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/rank.sqlite"
  }
});
