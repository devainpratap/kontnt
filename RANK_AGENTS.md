# RANK_AGENTS.md

Guidance for agents working on **RankOS** (`apps/rank-server`, `apps/rank-web`,
`packages/rank-shared`). This is the second product in this monorepo. The first
is ContentOS (`apps/server`, `apps/web`) — see [AGENTS.md](AGENTS.md) for that
one. Read this file before proposing architectural changes to RankOS.

## Purpose

A local-first, multi-client SEO intelligence dashboard for an agency operator.
It answers two questions per client: *"where do we rank?"* and *"what changed in
search, and why?"*

Three layers, in dependency order:

1. **Truth layer** — Google Search Console API. Free, official, accurate, 16
   months of backfillable history. This is the foundation.
2. **Position layer** — live SERP position + full top 10, behind a swappable
   provider interface. Best-effort, never load-bearing.
3. **Intelligence layer** — Claude Code CLI (the user's Max subscription) turns
   pre-computed statistics into a written weekly client report.

## North Star

Build the smallest reliable local tool that can:

1. connect one Google account and sync every client property's Search Console data
2. track keyword positions and the competing top 10
3. surface what changed, honestly, without inventing data
4. narrate it into a client-ready report

## Locked Product Decisions

Fixed unless the user explicitly changes them:

- local-only web app; no hosting, no multi-tenancy, no user accounts, no billing
- **Search Console is the foundation; scraping is a bonus layer.** Never invert this
- SERP fetching always goes through the `SerpProvider` interface — no direct
  scraping calls anywhere else in the codebase
- files on disk under `clients/` are the source of truth; SQLite is an index and
  can be deleted and rebuilt
- SQLite database is **separate** from ContentOS (`data/rank.sqlite`)
- **zero imports from `apps/server` into `apps/rank-server`.** Patterns are
  copied, not imported, so RankOS work can never break ContentOS
- all statistics are computed deterministically in TypeScript; Claude only
  narrates a pre-computed table and never sees raw rows
- email delivery of the weekly report IS in scope (added at user request); no PDF
  generation, no backlink data, no site auditing in v1

## Correctness Rules (non-negotiable)

These exist because violating them means reporting wrong numbers to a paying
client. They are correctness requirements, not polish.

1. **Never fake a rank.** `rank_checks.status` distinguishes `not-found` (really
   ranked nowhere) from `blocked` / `error` (we do not know). A blocked check is
   never stored as a position.
2. **Charts render unknown as a gap**, never as 0, 100, or a carried-forward
   value. Never interpolate a missing position.
3. **Deltas are computed only between two `ok` checks.**
4. **GSC average position and live SERP position are different metrics.** Show
   them as separate, differently-labelled columns. Never average or blend them.
5. **The last 3 days of GSC data are provisional** and get revised by Google.
   Sync re-pulls a rolling window and upserts; the UI marks provisional days.
6. **GSC omits rare queries by design**, so query-level clicks never sum to the
   property total. Always show attribution coverage rather than hiding the gap.
7. **All dates are `YYYY-MM-DD` strings in GSC's timezone** (America/Los_Angeles).
   No `Date` objects in the persistence layer.

## Conventions

- Spawn child processes with **argument arrays**, never shell-interpolated
  strings.
- `schema.ts` is the single source of truth for the database. To change it: edit
  `apps/rank-server/src/db/schema.ts`, run
  `npx drizzle-kit generate --config drizzle.rank.config.ts`, commit the
  migration. Never hand-write DDL in `client.ts`.
- Markdown via `writeMarkdownFile`, JSON via `writeJsonFile`. Never raw `writeFile`.
- Long operations are fire-and-poll: POST returns 202, an in-flight lock prevents
  double-runs, status is read from `sync_runs`.
- Any user-supplied URL passes the SSRF guard before it is fetched.
- Tests are `node --test` with the `tsx` importer, not Jest/Vitest (server side).

## Ports and paths

| | ContentOS | RankOS |
|---|---|---|
| API | :3001 | :3102 |
| Web | :5173 | :5274 |
| DB | `data/workflow.sqlite` | `data/rank.sqlite` |
| Data | `jobs/` | `clients/` |
| Migrations | `apps/server/drizzle` | `apps/rank-server/drizzle` |
| Shared pkg | `@semantic-seo/shared` | `@rankos/shared` |

## Build Rules

- Keep the UI operational and plain. This is a work tool.
- The UI must never accept arbitrary shell input.
- Every phase ends in something runnable. `npm run check` stays green.
