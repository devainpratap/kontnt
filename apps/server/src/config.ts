import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3001),
  WORKFLOW_ROOT: z.string().optional(),
  DB_PATH: z.string().optional(),
  CODEX_CLI_BIN: z.string().default("codex"),
  CODEX_MODEL: z.string().default(""),
  CODEX_SANDBOX: z
    .preprocess(
      (value) => (value === "workspace-write" || value === "read-only" || value === "danger-full-access" ? value : undefined),
      z.enum(["workspace-write", "read-only", "danger-full-access"]).default("workspace-write")
    ),
  CODEX_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  CODEX_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(5_000_000),
  // "claude" = Claude Code CLI via your Claude subscription (default, no API key);
  // "claude-api" = Anthropic Messages API (needs ANTHROPIC_API_KEY);
  // "codex" = Codex CLI.
  GENERATION_PROVIDER: z.enum(["claude", "claude-api", "codex"]).default("claude"),
  CLAUDE_CLI_BIN: z.string().default("claude"),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(64000),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  SERVE_WEB: z
    .preprocess((value) => (value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : value), z.boolean().default(false)),
  GENERATION_FALLBACK_MODE: z.enum(["manual"]).default("manual")
});

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultWorkspaceRoot = resolve(serverRoot, "../..");
const env = configSchema.parse(process.env);

export const appConfig = {
  host: env.HOST,
  port: env.PORT,
  workspaceRoot: resolve(env.WORKFLOW_ROOT ?? defaultWorkspaceRoot),
  jobsRoot: resolve(env.WORKFLOW_ROOT ?? defaultWorkspaceRoot, "jobs"),
  promptsRoot: resolve(env.WORKFLOW_ROOT ?? defaultWorkspaceRoot, "prompts"),
  dataRoot: resolve(env.WORKFLOW_ROOT ?? defaultWorkspaceRoot, "data"),
  dbPath: resolve(env.DB_PATH ?? resolve(env.WORKFLOW_ROOT ?? defaultWorkspaceRoot, "data/workflow.sqlite")),
  codexBin: env.CODEX_CLI_BIN,
  codexModel: env.CODEX_MODEL,
  codexSandbox: env.CODEX_SANDBOX,
  codexTimeoutMs: env.CODEX_TIMEOUT_MS,
  codexMaxOutputBytes: env.CODEX_MAX_OUTPUT_BYTES,
  generationProvider: env.GENERATION_PROVIDER,
  claudeCliBin: env.CLAUDE_CLI_BIN,
  anthropicModel: env.ANTHROPIC_MODEL,
  anthropicEffort: env.ANTHROPIC_EFFORT,
  anthropicMaxTokens: env.ANTHROPIC_MAX_TOKENS,
  anthropicTimeoutMs: env.ANTHROPIC_TIMEOUT_MS,
  corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  serveWeb: env.SERVE_WEB,
  webDistPath: resolve(serverRoot, "../web/dist"),
  fallbackMode: env.GENERATION_FALLBACK_MODE
};

export async function ensureWorkspaceDirs() {
  await Promise.all([
    mkdir(appConfig.jobsRoot, { recursive: true }),
    mkdir(appConfig.promptsRoot, { recursive: true }),
    mkdir(appConfig.dataRoot, { recursive: true })
  ]);
}
