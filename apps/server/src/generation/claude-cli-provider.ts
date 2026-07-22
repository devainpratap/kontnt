import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

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

const OUTPUT_TRUNCATION_MARKER = "\n…[output truncated]";
const KILL_GRACE_MS = 5000;
const CANCELLED_EXIT_CODE = 130;

// Full-replacement system prompt: strips Claude Code's coding-agent scaffolding
// so the CLI behaves as a pure writer and returns only the article Markdown.
const WRITING_SYSTEM_PROMPT = [
  "You are an expert SEO content strategist and long-form writer.",
  "You are NOT a coding agent: do not use tools, do not read or write files, do not run commands.",
  "Follow the user's instructions precisely and completely.",
  "Respond with ONLY the requested deliverable as clean GitHub-flavored Markdown —",
  "no preamble, no sign-off, no commentary about your process, and no code fences wrapping the whole document.",
  "Never emit em dashes or en dashes; use a plain hyphen with spaces instead.",
  "Write natural, human, non-repetitive prose that reads like an edited draft, not an AI first pass."
].join(" ");

function createCappedBuffer(maxBytes: number) {
  let value = "";
  let bytes = 0;
  let truncated = false;

  return {
    append(chunk: Buffer) {
      if (truncated) {
        return;
      }
      const remaining = maxBytes - bytes;
      if (chunk.byteLength <= remaining) {
        value += chunk.toString();
        bytes += chunk.byteLength;
        return;
      }
      if (remaining > 0) {
        value += chunk.subarray(0, remaining).toString();
        bytes += remaining;
      }
      value += OUTPUT_TRUNCATION_MARKER;
      truncated = true;
    },
    get value() {
      return value;
    }
  };
}

// Robust spawn with SIGTERM→SIGKILL timeout, output cap, and external
// cancellation — mirrors the codex provider so both engines behave identically.
function runClaude(args: string[], options: { stdin?: string; signal?: AbortSignal; timeoutMs: number } = { timeoutMs: 600000 }) {
  return new Promise<CommandResult>((resolve) => {
    const { signal } = options;

    if (signal?.aborted) {
      resolve({ exitCode: CANCELLED_EXIT_CODE, stdout: "", stderr: "Claude generation cancelled" });
      return;
    }

    // Run in a neutral cwd so the CLI does not load the repo's CLAUDE.md /
    // project settings into the generation context.
    const child = spawn(appConfig.claudeCliBin, args, {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    const stdout = createCappedBuffer(appConfig.codexMaxOutputBytes);
    const stderr = createCappedBuffer(appConfig.codexMaxOutputBytes);

    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let timeoutKillHandle: NodeJS.Timeout | undefined;
    let cancelKillHandle: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const finish = (result: CommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (timeoutKillHandle) clearTimeout(timeoutKillHandle);
      if (cancelKillHandle) clearTimeout(cancelKillHandle);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
      resolve(result);
    };

    const cancelledResult = (): CommandResult => ({
      exitCode: CANCELLED_EXIT_CODE,
      stdout: stdout.value,
      stderr: `${stderr.value}\nClaude generation cancelled`.trim()
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      timeoutKillHandle = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ exitCode: 124, stdout: stdout.value, stderr: `${stderr.value}\nClaude generation timed out after ${options.timeoutMs}ms` });
      }, KILL_GRACE_MS);
    }, options.timeoutMs);

    if (signal) {
      abortListener = () => {
        cancelled = true;
        child.kill("SIGTERM");
        cancelKillHandle = setTimeout(() => {
          child.kill("SIGKILL");
          finish(cancelledResult());
        }, KILL_GRACE_MS);
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));

    child.on("error", () => {
      finish({ exitCode: 127, stdout: stdout.value, stderr: "Claude Code CLI was not found on the PATH." });
    });

    child.on("close", (exitCode) => {
      if (cancelled) {
        finish(cancelledResult());
        return;
      }
      if (timedOut) {
        finish({ exitCode: 124, stdout: stdout.value, stderr: `${stderr.value}\nClaude generation timed out after ${options.timeoutMs}ms` });
        return;
      }
      finish({ exitCode: exitCode ?? 1, stdout: stdout.value, stderr: stderr.value });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function stripEnclosingFence(text: string) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

export function isTransientClaudeCliFailure(result: CommandResult) {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    combined.includes("rate limit") ||
    combined.includes("overloaded") ||
    combined.includes("usage limit") ||
    combined.includes("econnreset") ||
    combined.includes("etimedout") ||
    combined.includes("network error") ||
    combined.includes("fetch failed")
  );
}

export async function getClaudeCliStatus(): Promise<ProviderStatus> {
  const versionResult = await runClaude(["--version"], { timeoutMs: 15000 });
  if (versionResult.exitCode !== 0) {
    return {
      available: false,
      authenticated: false,
      message: versionResult.stderr || "Claude Code CLI is not available."
    };
  }

  // The CLI reuses the logged-in Claude subscription (Max/Pro). There is no
  // cheap auth probe short of a generation, so we treat an available CLI as
  // ready; an auth failure at generation time degrades to a manual handoff.
  return {
    available: true,
    authenticated: true,
    message: `Claude Code (your Claude subscription) is ready — model ${appConfig.anthropicModel}.`
  };
}

export async function runClaudeCliStep(options: {
  cwd: string;
  outputPath: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<CommandResult> {
  if (options.signal?.aborted) {
    return { exitCode: CANCELLED_EXIT_CODE, stdout: "", stderr: "Claude generation cancelled" };
  }

  const args = [
    "-p",
    "--model",
    appConfig.anthropicModel,
    "--output-format",
    "text",
    "--system-prompt",
    WRITING_SYSTEM_PROMPT
  ];

  const result = await runClaude(args, {
    stdin: options.prompt,
    signal: options.signal,
    timeoutMs: appConfig.anthropicTimeoutMs
  });

  if (result.exitCode !== 0) {
    return result;
  }

  const text = result.stdout.trim();
  if (!text) {
    return { exitCode: 1, stdout: "", stderr: "Claude returned no text output." };
  }

  const output = stripEnclosingFence(text);
  await writeFile(options.outputPath, output, "utf8");

  return { exitCode: 0, stdout: output, stderr: "" };
}
