# Semantic SEO Content Workflow

Local-first content workflow app for building semantic SEO articles with:

- a React frontend
- a Fastify backend
- local Markdown/JSON job folders
- SQLite metadata
- Codex CLI as the primary generation path
- ChatGPT.com handoff prompts as the fallback path

## Workspace Layout

```text
apps/
  server/
  web/
packages/
  shared/
data/
jobs/
prompts/
```

## Recommended Runtime

The primary v1 path is a local Node runtime on your machine. That keeps file storage simple, matches the PRD, and lets the backend reuse your existing Codex CLI setup when it is already working outside containers.

## Local Run

Expected tools:

- Node.js 22+
- npm
- Codex CLI if you want in-app generation
- Docker Desktop only if you want the optional container setup

Create a local env file:

```bash
cp .env.example .env
```

Install dependencies and create the local runtime folders:

```bash
npm install
npm run setup
```

Start the backend in one terminal:

```bash
npm run dev:server
```

Start the frontend in a second terminal:

```bash
npm run dev:web
```

Frontend:

- `http://localhost:5173`

Backend health:

- `http://localhost:3001/api/health`

## Docker Run

Docker is provided as a convenience for booting the UI and backend together. The compose setup bind-mounts the repo, keeps dependencies in a named volume, and mounts your host Codex config into the server container so the backend can reuse the same local Codex login when file-backed Codex auth is available.

Create `.env` first if you have not already:

```bash
cp .env.example .env
```

Then start both services:

```bash
npm run docker:up
```

Frontend:

- `http://localhost:5173`

Backend:

- `http://localhost:3001/api/health`

If you already have local services on the default ports, use alternate host ports:

```bash
SERVER_PORT=13001 WEB_PORT=15173 docker-compose up --build
```

## Codex CLI in Docker

The backend is wired to use `codex exec` in non-interactive mode. The server image installs the Codex CLI, but authentication inside Docker is a separate concern.

Important reality check:

- The compose file mounts `${HOME}/.codex` to `/root/.codex` in the server container.
- If your host Codex login is file-backed, `/api/health` should report Codex as authenticated in Docker.
- If your host login depends on a platform service the container cannot access, the app still boots and the manual ChatGPT.com handoff path remains available.
- For the least surprising Codex-backed generation path, the local Node runtime is still the recommended default.

## Helper Scripts

Useful root-level commands:

- `npm run setup` creates the local `data/`, `jobs/`, and prompt folders used by the scaffold.
- `npm run check` runs the current build and typecheck passes across workspaces.
- `npm test` runs the backend route tests.
- `npm run docker:up` / `npm run docker:down` manage the optional Compose stack through `docker-compose`.

## Current Status

This repo is scaffolded through the first vertical slice:

- job creation
- intake persistence
- competitor extraction review
- semantic map generation trigger
- outline generation trigger
- outline approval
- draft generation trigger
- final optimization trigger
- prompt snapshotting
- manual handoff generation when Codex is unavailable
- Markdown and HTML exports
- direct open and download links for saved artifacts
- backend route tests for the core job, artifact, and export behavior
