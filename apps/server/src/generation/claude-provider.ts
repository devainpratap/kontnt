import { writeFile } from "node:fs/promises";

import Anthropic from "@anthropic-ai/sdk";

import { appConfig } from "../config";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ProviderStatus = {
  available: boolean;
  authenticated: boolean;
  message: string;
};

// Non-zero exit used for an externally cancelled run — mirrors the codex
// provider so the step runner treats both engines identically.
const CANCELLED_EXIT_CODE = 130;

// Any failure carrying this marker is retryable; the step runner degrades the
// step to manual-input-required rather than a hard failure.
const TRANSIENT_MARKER = "[transient]";

const WRITING_SYSTEM_PROMPT = [
  "You are an expert SEO content strategist and long-form writer.",
  "Follow the user's instructions precisely and completely.",
  "Produce ONLY the requested deliverable as clean GitHub-flavored Markdown —",
  "no preamble, no sign-off, no commentary about your process, and no code fences wrapping the whole document.",
  "Never emit em dashes or en dashes; use a plain hyphen with spaces instead.",
  "Write natural, human, non-repetitive prose that reads like an edited draft, not an AI first pass."
].join(" ");

function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Unwrap a whole-document ```markdown fence if the model wrapped its output. */
function stripEnclosingFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

function describeError(error: unknown) {
  if (error instanceof Anthropic.APIError) {
    return `Claude API error${error.status ? ` (${error.status})` : ""}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown Claude generation error.";
}

export function isTransientClaudeFailure(result: CommandResult) {
  return result.stderr.includes(TRANSIENT_MARKER);
}

export async function getClaudeStatus(): Promise<ProviderStatus> {
  if (!hasCredentials()) {
    return {
      available: true,
      authenticated: false,
      message: "Claude is not authenticated. Set ANTHROPIC_API_KEY to enable in-app generation."
    };
  }

  return {
    available: true,
    authenticated: true,
    message: `Claude is ready (model ${appConfig.anthropicModel}).`
  };
}

export async function runClaudeStep(options: {
  cwd: string;
  outputPath: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<CommandResult> {
  if (!hasCredentials()) {
    return { exitCode: 127, stdout: "", stderr: "Claude is not authenticated (ANTHROPIC_API_KEY is not set)." };
  }

  if (options.signal?.aborted) {
    return { exitCode: CANCELLED_EXIT_CODE, stdout: "", stderr: "Claude generation cancelled" };
  }

  // The SDK auto-retries 429/5xx/connection errors with backoff; a generous
  // timeout plus streaming keeps long, high-effort writes from hitting HTTP
  // timeouts.
  const client = new Anthropic({ timeout: appConfig.anthropicTimeoutMs });

  try {
    const stream = client.messages.stream(
      {
        model: appConfig.anthropicModel,
        max_tokens: appConfig.anthropicMaxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: appConfig.anthropicEffort },
        system: WRITING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: options.prompt }]
      },
      { signal: options.signal }
    );

    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      const category = (message as { stop_details?: { category?: string | null } }).stop_details?.category ?? "policy";
      return { exitCode: 1, stdout: "", stderr: `Claude declined to generate this content (${category}).` };
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      return { exitCode: 1, stdout: "", stderr: "Claude returned no text output." };
    }

    const output = stripEnclosingFence(text);
    await writeFile(options.outputPath, output, "utf8");

    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || options.signal?.aborted) {
      return { exitCode: CANCELLED_EXIT_CODE, stdout: "", stderr: "Claude generation cancelled" };
    }

    if (
      error instanceof Anthropic.RateLimitError ||
      error instanceof Anthropic.InternalServerError ||
      error instanceof Anthropic.APIConnectionError
    ) {
      return { exitCode: 1, stdout: "", stderr: `${TRANSIENT_MARKER} ${describeError(error)}` };
    }

    return { exitCode: 1, stdout: "", stderr: describeError(error) };
  }
}
