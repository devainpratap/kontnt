# Semantic SEO Content Workflow Tech Stack

## Purpose

This document translates the PRD into a concrete build stack and narrows the open-source local-hostable options for each layer.

The target outcome is a simple, reliable, local-first content workflow app that uses Codex CLI as the primary generation path and keeps article work on the user's machine.

## Recommendation

Build v1 as a local web app with a small local Node service.

Selected stack:

- App model: local browser app on `127.0.0.1`
- Frontend: Vite + React + TypeScript
- Routing: React Router
- Data fetching: TanStack Query
- Styling: Tailwind CSS with a small in-repo component layer
- Backend: Fastify + TypeScript
- Validation: Zod
- Database: SQLite + Drizzle ORM + better-sqlite3
- Job orchestration: custom in-app step runner
- Prompt management: Markdown templates with YAML frontmatter
- Extraction: built-in fetch + Cheerio + JSDOM + Mozilla Readability
- Optional extraction fallback later: Trafilatura
- Process execution: Node `child_process.spawn()`

## Why This Stack

This stack best matches the PRD because it is:

- local-first
- simple to run
- easy to debug
- compatible with Codex CLI on the host machine
- flexible enough for prompt-heavy workflows
- not dependent on Docker or external automation infrastructure

It also keeps the product in the shape of a focused app rather than an automation graph editor.

## Decision Summary

| Layer | Selected | Why |
|---|---|---|
| App shell | Local web app | Fastest path, simplest setup, no desktop packaging overhead |
| Frontend | Vite + React | Lightweight and fast for a local operational UI |
| Routing | React Router | Minimal routing without full-stack framework overhead |
| Async state | TanStack Query | Good fit for job status and rerun workflows |
| Styling | Tailwind CSS | Fast to build a clean operational interface |
| Backend | Fastify | Strong structure, schema-friendly, lightweight |
| Validation | Zod | Shared request and file schema validation |
| Metadata DB | SQLite | Zero-admin local persistence |
| ORM | Drizzle | Type-safe and lightweight for SQLite |
| SQLite driver | better-sqlite3 | Stable local file-backed SQLite driver |
| Workflow engine | Custom step runner | Simpler than external orchestration tools |
| Prompt system | Markdown + frontmatter | Editable, versionable, reproducible |
| Extraction | Cheerio + Readability | Good balance of simplicity and content quality |

## Layer By Layer Options

### 1. App Model

Selected: local web app in the browser.

Why:

- easiest to develop and iterate
- no desktop packaging burden in v1
- can still use host filesystem and Codex CLI through the backend
- fits the PRD's simple workbench UI

Alternatives considered:

- Tauri:
  Strong later if we want a packaged desktop app with tighter native permissions.
- Electron:
  Mature, but heavier and easier to get wrong from a security perspective.
- Next.js:
  Works, but brings more framework surface than this app needs.

Decision:

Start with a local web app. Wrap it in Tauri later only if desktop distribution becomes a real need.

### 2. Frontend

Selected:

- Vite
- React
- TypeScript
- React Router
- TanStack Query

Why:

- Vite is fast and lean for local development.
- React gives predictable UI composition for a multi-step workflow.
- React Router supports a small app without forcing full-stack framework patterns.
- TanStack Query handles job fetches, step status refreshes, and retries cleanly.

Alternatives considered:

- Next.js:
  Good full-stack framework, but unnecessary for a local tool with a separate Node runner.
- Plain React without router:
  Possible, but route-based screens make the workspace easier to maintain.

Decision:

Use Vite React with route-based screens and Query for server-backed state. Avoid Redux or global state frameworks in v1.

### 3. UI And Styling

Selected:

- Tailwind CSS
- small in-repo component layer
- native textareas first

Why:

- fast to build a tidy operational UI
- zero-runtime CSS generation model
- easy to keep visual polish without building a design system first
- avoids dragging in a large UI framework

Alternatives considered:

- shadcn/ui:
  Useful source of patterns, but we should not blindly import a large component set if native elements are enough.
- Radix UI:
  Good if we need accessible dialogs, tabs, or tooltips; optional, not default.
- full component kits:
  Too much weight for the first version.

Decision:

Use Tailwind plus a very small local component layer. Add Radix only for specific primitives if the native versions become awkward.

### 4. Backend

Selected:

- Node.js
- Fastify
- TypeScript
- Zod

Why:

- matches the PRD's local process-runner direction
- easy shell integration for Codex CLI
- easy local file access
- structured enough for request validation and step orchestration

Alternatives considered:

- Hono:
  Very nice and small, but Fastify is a better fit for a slightly more structured local service.
- Express:
  Familiar, but Fastify offers a cleaner modern base for validation-heavy endpoints.

Decision:

Use Fastify as the local API server and keep it bound to localhost only.

### 5. Database And Storage

Selected:

- job folders with Markdown and JSON files as source of truth
- SQLite for metadata
- Drizzle ORM
- better-sqlite3 driver

Why:

- the article itself belongs on disk where the user can inspect it
- SQLite is enough for job status, timestamps, and indexing
- Drizzle keeps schema and queries typed without adding much weight
- better-sqlite3 is a practical local SQLite choice

Alternatives considered:

- Postgres:
  Unnecessary setup for a local-first single-user tool.
- No database at all:
  Possible, but job listing and step status get awkward quickly.

Decision:

Store article assets in files and use SQLite only for the app's lightweight operational metadata.

### 6. Workflow Orchestration

Selected:

- custom in-app step runner
- one step at a time for v1
- optional low-concurrency queue later

Why:

- the workflow is linear and product-specific
- the app needs explicit approval gating and file snapshots
- external workflow tools would duplicate the UI and add operational weight

Alternatives considered:

- n8n:
  Strong for general automation, but not open-source in the strict OSI sense and too heavy for this core product flow.
- Node-RED:
  Better for automation graphs than structured content workbenches.
- Activepieces:
  Better for external integrations than the core writing workflow.
- Windmill:
  The best escalation path later if the app becomes a broader orchestration platform.
- BullMQ:
  Strong, but introduces Redis-class infrastructure too early.

Decision:

Build the runner in-app. Consider Windmill only if the workflow expands beyond a single local content workbench.

### 7. Prompt Management

Selected:

- Markdown prompt files
- YAML frontmatter
- per-job prompt snapshots

Why:

- prompts stay readable and editable
- job snapshots preserve reproducibility
- no extra prompt management infrastructure is needed in v1

Alternatives considered:

- Langfuse:
  Powerful, but much heavier operationally than this app needs.
- Promptfoo:
  Useful for evaluation later, not a primary prompt CMS.

Decision:

Keep prompts in versioned files and copy rendered prompts into each job folder before execution.

### 8. Competitor URL And Article Extraction

Selected:

- Node built-in `fetch`
- Cheerio
- JSDOM
- Mozilla Readability

Why:

- fetch handles network requests without extra complexity
- Cheerio is good for fast heading and metadata extraction
- Readability improves main-body extraction quality
- JSDOM is the bridge Readability needs in Node

Optional later:

- Trafilatura for harder extraction cases
- Postlight Parser if we want a Node-only alternative for richer article parsing

Decision:

Start with a simple Node-native extraction path and add Trafilatura only if real pages expose weaknesses.

## Detailed Selected Libraries

### Frontend

- `react`
- `react-dom`
- `react-router`
- `@tanstack/react-query`
- `tailwindcss`
- `react-hook-form`
- `zod`

Notes:

- Use `react-hook-form` for the intake form because the brief has many fields and conditional sections.
- Keep local state local. Avoid adding Zustand or Redux in v1.

### Backend

- `fastify`
- `zod`
- `drizzle-orm`
- `better-sqlite3`
- `gray-matter`
- `js-yaml` or frontmatter parser bundled with `gray-matter`
- `cheerio`
- `jsdom`
- `@mozilla/readability`

Notes:

- `gray-matter` is a good fit for prompt file frontmatter parsing.
- Keep the backend in charge of prompt rendering and step snapshots.

### Process Execution

Selected:

- `child_process.spawn()`

Rules:

- allowlist command and arguments
- no arbitrary user-entered shell commands
- fixed working directories
- explicit step timeouts
- stdout and stderr capture
- output size limits

## Local Hostable Open-Source Options

These are the best options by category for this product:

| Category | Best v1 option | Best later option |
|---|---|---|
| Local app shell | Vite + React + Fastify | Tauri wrapper |
| Metadata DB | SQLite | Postgres only if multi-user or remote |
| Workflow engine | Custom in-app runner | Windmill |
| Prompt storage | Markdown files | Langfuse if prompt ops become complex |
| Extraction | Cheerio + Readability | Add Trafilatura |

## Options Rejected For V1

### n8n

Reason:

- too product-heavy for the core workflow
- awkward fit for rich outline review and article editing
- not the cleanest match for a local host CLI-driven content app

Use later only for side integrations such as publishing, notifications, or external sync.

### Trigger.dev

Reason:

- excellent for background job infrastructure
- unnecessary operational surface for a single-user local app

### Node-RED

Reason:

- better for automation graphs than guided editorial workflows

### BullMQ

Reason:

- strong queue system, but adds Redis-class infrastructure too early

## Security And Reliability Requirements

- bind backend to localhost only
- validate every request payload with shared schemas
- never let the frontend submit raw shell commands
- normalize job paths before file reads or writes
- log command duration, exit code, and output paths
- separate generated files from user-edited files
- protect approved outlines from accidental overwrite

## Recommended Implementation Order

1. scaffold Vite frontend and Fastify backend
2. add SQLite metadata and file-backed job folders
3. add intake form and validation
4. add Codex CLI check and generation wrapper
5. add semantic map generation
6. add outline generation and approval
7. add draft generation and final optimization
8. add URL extraction and prompt snapshotting

## Source Links

Core stack:

- Vite: https://vite.dev/guide/
- React Router: https://reactrouter.com/start/home
- TanStack Query: https://tanstack.com/query/docs
- Fastify: https://fastify.dev/
- Drizzle ORM overview: https://orm.drizzle.team/docs/overview
- Drizzle SQLite: https://orm.drizzle.team/docs/get-started-sqlite
- Tailwind CSS: https://tailwindcss.com/docs/installation/using-postcss

Execution and extraction:

- Node `child_process`: https://nodejs.org/api/child_process.html
- Node fetch: https://nodejs.org/en/learn/getting-started/fetch
- Cheerio: https://cheerio.js.org/
- Mozilla Readability: https://github.com/mozilla/readability
- Trafilatura: https://pypi.org/project/trafilatura/
- Postlight Parser: https://github.com/postlight/parser

Alternative orchestration options:

- n8n docs: https://docs.n8n.io/
- n8n self-hosting and license context: https://docs.n8n.io/choose-n8n/ and https://docs.n8n.io/sustainable-use-license/
- Windmill: https://www.windmill.dev/docs/getting_started/how_to_use_windmill
- BullMQ: https://docs.bullmq.io/guide/queues
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Tauri shell plugin: https://v2.tauri.app/plugin/shell/
