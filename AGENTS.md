# AGENTS.md

## Purpose

This repository is for a local-first Semantic SEO content workflow app that turns a manual multi-step article process into a guided local tool.

The product must:

- use the user's local Codex CLI login for generation when available
- keep article data local on disk
- preserve one human approval gate at the outline step
- produce high-quality Markdown article outputs
- generate ChatGPT.com handoff prompts as a fallback

Read these files first:

1. `Semantic_SEO_Content_Workflow_PRD.md`
2. `Semantic_SEO_Content_Workflow_Tech_Stack.md`
3. `INIT.md`

## North Star

Build the smallest reliable local app that can:

1. collect article inputs
2. run semantic analysis
3. generate and approve an outline
4. draft the article
5. optimize the final article
6. export Markdown and fallback prompts

Do not drift into building a general automation platform, CMS, or SaaS dashboard in v1.

## Locked Product Decisions

These decisions are fixed unless explicitly changed by the user:

- v1 is a local web app, not a hosted service
- Codex CLI is the primary generation path
- ChatGPT.com prompt handoff is the fallback path
- local files are the source of truth for article content
- SQLite is for metadata and step status only
- one approval gate exists before full drafting
- no n8n, Trigger.dev, Node-RED, Windmill, or Docker as the core runtime in v1

## Selected Stack

- Frontend: Vite + React + TypeScript
- Routing: React Router
- Styling: Tailwind CSS with a small in-repo component layer
- Server state: TanStack Query
- Backend: Node.js + Fastify + TypeScript
- Validation: Zod
- Database: SQLite + Drizzle ORM + better-sqlite3
- Storage: job folders with Markdown and JSON files
- Prompt management: Markdown templates with YAML frontmatter
- Extraction: fetch + Cheerio + JSDOM + Mozilla Readability
- Process execution: `child_process.spawn()` with strict allowlisting

## Planned Repository Shape

```text
apps/
  web/
  server/
packages/
  shared/
  prompts/
  extraction/
jobs/
prompts/
  system/
  steps/
```

If the repo starts smaller, preserve the same boundaries even if folders are merged temporarily.

## Agent Roles

When working in parallel, use clear ownership:

- Product/Architecture agent:
  Owns PRD alignment, flow decisions, and high-level architecture docs.
- Frontend agent:
  Owns `apps/web` and UX for intake, outline approval, and output review.
- Backend agent:
  Owns `apps/server`, API routes, step runner, Codex CLI integration, and file I/O.
- Prompt agent:
  Owns `prompts/` and prompt rendering rules.
- Extraction agent:
  Owns URL fetch, content extraction, and competitor parsing utilities.
- QA agent:
  Owns tests, regression checks, and workflow verification.

Avoid overlapping edits when using multiple agents. If two tasks need the same file, keep one owner and let the other provide review notes instead of direct edits.

## Build Rules

- Keep the UI operational and plain. This is a work tool, not a landing page.
- Prefer local browser UI over desktop wrappers in v1.
- Do not add hosted services unless the user asks for them.
- Do not require API keys for the default happy path.
- Never allow arbitrary shell input from the UI.
- Only run approved Codex CLI commands from fixed backend code paths.
- Save every generated prompt and output into the job folder for reproducibility.
- Never overwrite a user-approved outline without explicit confirmation.
- Keep prompts editable as files, not hardcoded strings only.

## Data Rules

Each article job must preserve:

- original intake data
- raw generated semantic map
- generated outline
- approved outline
- draft
- final optimized article
- ChatGPT.com handoff prompts
- run logs and errors

SQLite stores status and indexing. The article files on disk remain the primary record.

## Prompt Quality Rules

Every content step should optimize for:

- reader usefulness before SEO theater
- strong topical coverage
- natural entity use
- no unsupported factual claims
- clear H2 and H3 structure
- smooth transitions between sections
- non-promotional product mentions unless requested otherwise
- visible verification notes for uncertain claims

## Safety Rules

- Use `spawn()` or equivalent argument-based process execution.
- Never interpolate raw user strings into shell commands.
- Normalize and validate all file paths.
- Keep all writes inside the configured workspace.
- Add timeouts, output caps, and retries for generation steps.
- Show plain-language recovery paths in the UI when a step fails.

## Definition Of Done

The MVP is complete when a user can:

1. create a new article job
2. fill an intake form
3. generate a semantic map
4. generate and edit an outline
5. approve the outline
6. generate a draft
7. run final optimization
8. export the final article and fallback prompts

## Working Style

- Make small, reversible changes.
- Prefer clarity over cleverness.
- Keep docs close to the implementation.
- When unsure, bias toward the simpler local option.
- When adding a dependency, explain why the built-in platform was not enough.
