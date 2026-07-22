# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **local-first Semantic SEO content workflow app**. It turns a manual multi-step
article process into a guided local tool: intake → semantic map → outline (with a
human approval gate) → draft → final optimization → export. Generation runs through
the user's local **Codex CLI** (`codex exec`); when Codex is unavailable it falls
back to writing a ChatGPT.com handoff prompt to disk. See [AGENTS.md](AGENTS.md) for
the locked product decisions — read it before proposing architectural changes, as
several directions (no hosted services, no n8n/Trigger.dev, SQLite for metadata only,
files as source of truth) are deliberately off the table for v1.

## Commands

npm workspaces monorepo. Run from the repo root:

```bash
npm install && npm run setup   # setup creates data/, jobs/, prompts/ runtime folders
npm run dev:server             # backend on :3001 (tsx watch)
npm run dev:web                # frontend on :5173 (Vite, proxies /api to :3001)
npm run check                  # build + typecheck + test — run before finishing work
npm test                       # backend node:test suite only
npm run docker:up              # optional: boot both services via docker-compose
```

Run a **single test file** (tests are `node --test` with the `tsx` importer, not Jest/Vitest):

```bash
node --import tsx --test apps/server/src/routes.test.ts
```

`cp .env.example .env` before first run. Key env: `WORKFLOW_ROOT` (default repo root),
`CODEX_CLI_BIN`, `CODEX_MODEL`, `CODEX_SANDBOX` (`workspace-write` default).

## Architecture

Three workspaces: `apps/server` (Fastify + Drizzle/SQLite), `apps/web` (Vite + React +
TanStack Query + Tailwind), `packages/shared` (`@semantic-seo/shared` — Zod schemas,
types, and the `workflowSteps`/`jobStatuses`/`stepStatuses` string-literal enums that
both sides import).

### The two sources of truth

1. **Files on disk are the article record.** Every job is a folder under `jobs/<slug>-<id8>/`
   with fixed subdirs (`input/`, `prompts/`, `outputs/`, `handoffs/`, `exports/`). All
   paths are derived in one place — [buildJobPaths](apps/server/src/jobs/files.ts#L25).
   Never hardcode a job file path elsewhere; go through `JobPaths`.
2. **SQLite stores only status + indexing** (two tables: `jobs`, `job_steps`), via
   [JobRepository](apps/server/src/jobs/repository.ts). [db/schema.ts](apps/server/src/db/schema.ts)
   is the **single source of truth**; `initializeDatabase()` in
   [db/client.ts](apps/server/src/db/client.ts) runs the generated Drizzle migrations under
   [apps/server/drizzle/](apps/server/drizzle/) on boot (with a baseline-stamp for the
   pre-existing populated DB). To change the schema: edit `schema.ts`, run
   `npx drizzle-kit generate`, and commit the new migration — do not hand-write DDL in
   client.ts. On startup the repository also reconciles any steps left `running` by a
   crash/restart, flipping them to `failed`.

### The generation pipeline

[StepRunner](apps/server/src/generation/step-runner.ts) is the heart of the app. Each
step (`semantic-map`, `outline`, `draft`, `final-optimize`; plus the human-gated
`approve-outline`) does:

1. **Build prompt** from a Markdown template in `prompts/steps/` via
   [renderStepPrompt](apps/server/src/generation/prompt-loader.ts). Templates use
   `{{PLACEHOLDER}}` tokens filled with the article brief, semantic map, approved
   outline, draft, and the three shared system rule files from `prompts/system/`
   (`content-quality-rules`, `semantic-seo-rules`, `matrack-quality-rules`). The
   fully-rendered prompt is snapshotted into the job's `prompts/` folder for
   reproducibility.
2. **Check Codex** via [getCodexStatus](apps/server/src/generation/codex-provider.ts).
   If unavailable/unauthenticated → write a manual handoff and stop with status
   `manual-input-required`.
3. **Run** [runCodexStep](apps/server/src/generation/codex-provider.ts) — spawns
   `codex exec` with the prompt on stdin and `-o <relative output path>`. Retries once
   on *transient* failures (stream disconnects, etc.); a usage-limit hit also degrades to
   `manual-input-required` rather than hard `error`.
4. **Sanitize** output ([output-sanitizer.ts](apps/server/src/generation/output-sanitizer.ts)
   — mainly strips em/en dashes) then **audit-and-repair** (below).

Prompt building enforces step ordering by throwing `ApiError` when a prerequisite
artifact is missing (e.g. draft before final-optimize) — this is the guardrail, not the
route layer.

### Audit-and-repair loops (the current focus of active work)

This is where most recent commits land (branch `experiment/content-quality-v2`). After a
step generates output, `StepRunner.repairPostGenerationIssuesIfNeeded` runs a
**deterministic, code-based audit** and, if issues are found, feeds a repair prompt back
through Codex — up to N passes, re-auditing each time. Two audit engines:

- **Structure audit** ([article-structure-audit.ts](apps/server/src/generation/article-structure-audit.ts))
  — runs on the **outline** only. Checks entity/comparison ordering and section-purpose
  mixing. One repair pass.
- **Style audit** ([article-style-audit.ts](apps/server/src/generation/article-style-audit.ts))
  — runs on **draft** and **final-optimize**. This is the largest and most actively
  changed file (~1300 lines of small `add*Issues` detectors): banned phrases, repeated
  H2/H3 openers and heading echoes, repeated section shapes, semantic-glue/filler
  overuse, promotional-pitch density, etc. Up to 2 repair passes.

Audit reports and every repair prompt are written into the job folder (`outputs/*-audit.md`,
`prompts/*-repair-pass-*.md`) so a run is fully inspectable after the fact. When adding a
new quality rule, add a detector function to the relevant audit module and wire it into
the exported `auditArticle*` aggregator — the repair prompt renders from the returned
`issues` array automatically.

### Other backend pieces

- **Extraction** ([competitor-research.ts](apps/server/src/extraction/competitor-research.ts),
  [article-extractor.ts](apps/server/src/extraction/article-extractor.ts)) — fetches
  top-ranking URLs, extracts headings/excerpts with Readability + JSDOM + Cheerio. The
  prompt loader only injects extracted research when it's *fresh* (URL set matches intake).
- **Export** ([article-exporter.ts](apps/server/src/export/article-exporter.ts)) — final
  Markdown → Markdown/HTML/DOCX.
- API surface is a single flat file, [routes.ts](apps/server/src/routes.ts): job CRUD,
  intake, `extract-competitors`, one POST per step, `export`, and `artifacts`/`files`
  serving.

### Frontend

Thin client over the API. [JobWorkspacePage](apps/web/src/pages/JobWorkspacePage.tsx)
drives one job through the steps; state comes from the server via TanStack Query
([lib/api.ts](apps/web/src/lib/api.ts), [lib/workflow.ts](apps/web/src/lib/workflow.ts)).
Keep the UI operational and plain — it is a work tool, and it must never accept arbitrary
shell input (only the fixed Codex code paths run commands).

## Conventions specific to this repo

- **Codex is spawned with argument arrays**, never shell-interpolated strings — preserve
  this when touching `codex-provider.ts`.
- Markdown is written via `writeMarkdownFile` (trims trailing whitespace, ensures single
  trailing newline); JSON via `writeJsonFile` (2-space, trailing newline). Use these
  rather than raw `writeFile`.
- Step/status names are the string-literal unions in `packages/shared/src/constants.ts`.
  Adding a step means updating those arrays plus the maps in `step-runner.ts`, `files.ts`,
  `prompt-loader.ts`, and `routes.ts`.
- `jobs/` and `data/` are gitignored runtime output (only `.gitkeep` is tracked). The
  job folders present on disk are local run artifacts, not fixtures — don't rely on any
  specific job existing, and don't commit them.
