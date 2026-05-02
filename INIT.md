# INIT.md

## Goal

Initialize the project as a small local web app with a local Node backend that runs the Semantic SEO workflow through Codex CLI.

This file is the implementation starting point, not a product brief. The product brief lives in `Semantic_SEO_Content_Workflow_PRD.md`.

## First Build Target

Build a working vertical slice with these screens and steps:

1. Job List
2. Article Intake
3. Semantic Map
4. Outline Review
5. Draft and Final Output

The first usable version should support:

- local article job creation
- saving intake inputs to disk
- outline approval
- Markdown outputs
- ChatGPT.com fallback prompt generation

## Initial Project Structure

Use this structure first:

```text
apps/
  web/
    src/
  server/
    src/
packages/
  shared/
    src/
jobs/
prompts/
  system/
  steps/
```

## Initial Stack

- Package manager: `npm`
- Frontend: Vite + React + TypeScript
- Backend: Fastify + TypeScript
- Shared validation: Zod
- Metadata DB: SQLite via Drizzle ORM + better-sqlite3
- Prompt templates: Markdown + YAML frontmatter
- Extraction: Cheerio + JSDOM + Mozilla Readability

`npm` is preferred for the first pass because it avoids extra prerequisites. If workspace tooling becomes painful later, switching to `pnpm` is easy.

## Initial Backend Modules

Create these backend modules early:

- `config/`
  Loads workspace paths, model defaults, timeouts, and feature flags.
- `db/`
  Holds SQLite connection, schema, and migrations.
- `jobs/`
  Creates article job folders and manages status transitions.
- `prompts/`
  Loads templates, merges inputs, snapshots rendered prompts into job folders.
- `runner/`
  Executes workflow steps and handles reruns.
- `providers/codex/`
  Wraps Codex CLI execution and login checks.
- `extraction/`
  Fetches and parses competitor pages.

## Initial Frontend Modules

Create these frontend modules early:

- `routes/`
  Job list and article workspace routes.
- `components/`
  Small reusable inputs, panels, step headers, and action bars.
- `features/jobs/`
  Job creation, list, and status views.
- `features/intake/`
  Intake form and validation.
- `features/semantic-map/`
  Semantic output viewer and editor.
- `features/outline/`
  Outline review, approve, and regenerate actions.
- `features/draft/`
  Draft, optimized output, and export actions.

## First API Surface

Keep the first API small:

- `GET /health`
- `GET /settings`
- `GET /jobs`
- `POST /jobs`
- `GET /jobs/:jobId`
- `POST /jobs/:jobId/intake`
- `POST /jobs/:jobId/steps/semantic-map`
- `POST /jobs/:jobId/steps/outline`
- `POST /jobs/:jobId/steps/approve-outline`
- `POST /jobs/:jobId/steps/draft`
- `POST /jobs/:jobId/steps/final-optimize`
- `GET /jobs/:jobId/files/:type`

Avoid adding generic workflow endpoints in v1. Keep endpoints tied to the actual product flow.

## Prompt Template Conventions

Each prompt file should include YAML frontmatter:

```yaml
name: outline-generation
version: 1
description: Generates the article outline from the semantic map
inputs:
  - brief
  - semantic_map
  - preferences
```

Prompt body rules:

- keep instructions explicit
- define the exact output shape
- include quality rules inline
- avoid vague style guidance
- keep step prompts composable and testable

## Persistence Rules

- Store article inputs and outputs in the job folder.
- Store only status and indexing metadata in SQLite.
- Snapshot rendered prompts into each job folder before execution.
- Keep user-edited outline files separate from machine-generated outline files.

## Execution Rules

- Check that Codex CLI exists before running a generation step.
- Check login status before the first generation call.
- Use allowlisted arguments only.
- Capture stdout, stderr, exit code, duration, and output file path.
- Enforce step timeouts.
- Support rerunning an individual step without resetting the whole job.

## UI Rules

- Use a two-pane workspace where helpful, but do not over-design it.
- Prefer native text areas before adding a full editor dependency.
- Keep the main action for each step obvious.
- Show step status and last run time.
- Expose raw generated outputs for debugging.

## First Milestones

1. Scaffold web and server apps.
2. Add job creation and file-backed persistence.
3. Add intake form and save flow.
4. Add semantic map generation through Codex CLI.
5. Add outline generation and approval.
6. Add draft generation and final optimization.
7. Add ChatGPT.com handoff generation.

## Deferred Until Later

- desktop wrapper packaging
- WordPress publishing
- multi-user support
- background distributed queues
- n8n or Windmill integration
- OCR for SERP screenshots
- brand voice profiles

## Check Before Expanding Scope

Only expand to a desktop shell, heavier queue, or orchestration system if the local web app proves one of these:

- local server startup is a real UX problem
- multiple concurrent jobs are common
- extraction reliability is a recurring blocker
- prompt versioning becomes too hard with plain files
