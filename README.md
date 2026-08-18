# ContentOS + RankOS

Two local-first systems that run SEO content production and multi-client search reporting for a
digital agency. Built solo in TypeScript, in daily use.

`TypeScript` · `Fastify` · `React` · `SQLite / Drizzle` · `Google Search Console API` · `407 tests`

---

## RankOS — multi-client search intelligence

Answers two questions per client: *where do we rank?* and *what changed in search, and why?*

- Syncs **Google Search Console** across every client property, with 16 months of backfillable
  history.
- Tracks keyword positions and the competing top 10 behind a swappable SERP provider interface
  (SerpApi, ScrapingRobot, DataForSeo, or a local browser).
- Generates a written, client-ready **weekly report**, delivered automatically by email and as a
  WhatsApp team brief.
- Self-maintaining scheduler with rank-movement alerting and a supervised operations agent.

**The hard part was correctness, not the pipeline.** These reports go to paying clients, so
being wrong is worse than being late:

- A blocked or failed check is never stored as a position. `not-found` (really ranked nowhere)
  and `blocked` / `error` (we don't know) are different states.
- Charts render unknown as a **gap** — never as 0, never carried forward, never interpolated.
- Search Console average position and live SERP position are separate metrics, shown in separate
  columns. They are never blended.
- **Median-of-N SERP consensus** cancels proxy-rotation noise, and a statistical noise floor
  stops low-volume fluctuations being reported as ranking wins.
- Keywords resolve to a **search location** — a hyperlocal term checked from a national vantage
  will never find a local business, so it would report a client as unranked when they rank #3 in
  their own city.
- The last 3 days of Search Console data are provisional and get revised by Google, so the sync
  re-pulls a rolling window and the UI marks provisional days.
- Search Console omits rare queries by design, so query-level clicks never sum to the property
  total. The UI shows attribution coverage rather than hiding the gap.

All statistics are computed deterministically in TypeScript. The LLM only narrates a
pre-computed table — it never sees raw rows, so it cannot invent a number.

## ContentOS — semantic SEO content pipeline

Turns a manual multi-step article process into a guided tool:

```
intake → semantic map → outline (human approval gate) → draft → final optimization → export
```

- Grounds every brief in **live competitor SERP extraction** (Readability + Cheerio), so content
  is written against what actually ranks.
- Exports to Markdown, HTML and DOCX.
- Every rendered prompt is snapshotted into the job folder, so any run is reproducible.

**Quality control is code, not prompting.** After a step generates output, a deterministic audit
runs over it — banned phrasing, repeated H2/H3 openers, heading echoes, repeated section shapes,
filler and semantic-glue overuse, promotional density. If it finds issues, it feeds a targeted
repair prompt back through the model and re-audits, up to a bounded number of passes.

Audit reports and every repair prompt are written into the job folder, so a run is fully
inspectable after the fact.

---

## Architecture

Files on disk are the source of truth; SQLite is an index that can be deleted and rebuilt.
The two products share a monorepo but **zero code**, so work on one can never break the other.

```
apps/server        ContentOS API      (Fastify + Drizzle/SQLite)
apps/web           ContentOS UI       (Vite + React + TanStack Query + Tailwind)
apps/rank-server   RankOS API         (Fastify + Drizzle/SQLite)
apps/rank-web      RankOS UI          (Vite + React + TanStack Query + Tailwind)
packages/shared    ContentOS types, Zod schemas, string-literal enums
packages/rank-shared  RankOS types, Zod schemas
```

Design notes and the locked product decisions live in
[AGENTS.md](AGENTS.md) (ContentOS) and [RANK_AGENTS.md](RANK_AGENTS.md) (RankOS).

## Running locally

Requires Node.js 22+ and npm.

```bash
cp .env.example .env
npm install
npm run setup          # creates data/, jobs/, clients/, prompts/
```

| | Command | URL |
|---|---|---|
| ContentOS API | `npm run dev:server` | http://localhost:3001/api/health |
| ContentOS UI | `npm run dev:web` | http://localhost:5173 |
| RankOS API | `npm run dev:rank-server` | http://localhost:3102/api/health |
| RankOS UI | `npm run dev:rank-web` | http://localhost:5274 |

`npm run docker:up` boots the ContentOS pair via Compose instead.

## Tests

```bash
npm run check      # build + typecheck + test
npm test           # 407 tests across 102 suites
```

Run a single file — tests are `node --test` with the `tsx` importer, not Jest or Vitest:

```bash
node --import tsx --test apps/rank-server/src/serp/consensus.test.ts
```

## Notes

Local-first by design: no hosted services, no multi-tenancy, no accounts, no billing.
Client data lives under `clients/` and `jobs/` and is gitignored — this repo contains code only.
