import { appConfig } from "../config";
import { getClaudeCliStatus, isTransientClaudeCliFailure, runClaudeCliStep } from "./claude-cli-provider";
import { getClaudeStatus, isTransientClaudeFailure, runClaudeStep } from "./claude-provider";
import { getCodexStatus, isTransientCodexFailure, runCodexStep } from "./codex-provider";

// The generation engine is pluggable. All three providers expose the same
// { getStatus, runStep, isTransient } surface so the step runner is
// engine-agnostic.
//   - "claude"     (default): Claude Code CLI via the user's Claude subscription
//                             (Max/Pro) — no API key required.
//   - "claude-api": Anthropic Messages API (needs ANTHROPIC_API_KEY).
//   - "codex":      Codex CLI.
const provider = appConfig.generationProvider;
const isCodex = provider === "codex";
const isApi = provider === "claude-api";

export const generationProviderName: "claude" | "codex" = isCodex ? "codex" : "claude";
export const generationProviderLabel = isCodex ? "Codex" : "Claude";

export const getGenerationStatus = isCodex ? getCodexStatus : isApi ? getClaudeStatus : getClaudeCliStatus;
export const runGenerationStep = isCodex ? runCodexStep : isApi ? runClaudeStep : runClaudeCliStep;
export const isTransientGenerationFailure = isCodex
  ? isTransientCodexFailure
  : isApi
    ? isTransientClaudeFailure
    : isTransientClaudeCliFailure;
