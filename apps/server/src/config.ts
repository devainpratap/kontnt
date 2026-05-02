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
  fallbackMode: env.GENERATION_FALLBACK_MODE
};

export async function ensureWorkspaceDirs() {
  await Promise.all([
    mkdir(appConfig.jobsRoot, { recursive: true }),
    mkdir(appConfig.promptsRoot, { recursive: true }),
    mkdir(appConfig.dataRoot, { recursive: true })
  ]);
}
