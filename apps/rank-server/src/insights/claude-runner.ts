import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

import { rankConfig } from "../config";

/**
 * Running Claude Code against the operator's Max subscription.
 *
 * The spawn hardening here — SIGTERM then SIGKILL, an output cap, external
 * cancellation, transient-failure detection — is copied from ContentOS's
 * `generation/claude-cli-provider.ts` rather than imported, per the
 * zero-cross-app-imports rule in RANK_AGENTS.md. RankOS work must never be able
 * to break ContentOS.
 *
 * No API key is involved: the CLI reuses the logged-in subscription.
 */

export type ClaudeResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const OUTPUT_TRUNCATION_MARKER = "\n…[output truncated]";
const KILL_GRACE_MS = 5000;
const CANCELLED_EXIT_CODE = 130;

/**
 * Replaces Claude Code's coding-agent scaffolding with an analyst brief.
 *
 * Tool use is disabled explicitly: this task is pure interpretation of a table
 * that is already in the prompt, and a model that starts reading files or
 * running searches would be inventing context rather than using the data.
 */
const ANALYST_SYSTEM_PROMPT = [
  "You are a senior SEO analyst writing a performance report for an agency's client.",
  "You are NOT a coding agent: do not use tools, do not read or write files, do not run commands.",
  "You are given pre-computed statistics. They are correct. Never recalculate them, and never state a",
  "number that does not appear in the data you were given.",
  "Respond with ONLY the report as clean GitHub-flavored Markdown - no preamble, no sign-off, no",
  "commentary about your process, and no code fences wrapping the whole document.",
  "Never emit em dashes or en dashes; use a plain hyphen with spaces instead.",
  "Write plainly for a business owner. Be specific and concrete rather than reassuring."
].join(" ");

/**
 * System prompt for the short WhatsApp brief.
 *
 * Distinct from the analyst prompt: the brief's whole value is brevity and a
 * tone that reads well in a group chat. The one shared non-negotiable is the
 * same as everywhere else - never a number that is not in the data.
 */
const BRIEF_SYSTEM_PROMPT = [
  "You write short, punchy SEO updates for a team WhatsApp group.",
  "You are NOT a coding agent: do not use tools, do not read or write files, do not run commands.",
  "You are given pre-computed statistics. They are correct. Never recalculate them, and never state a",
  "number that is not in the data you were given.",
  "Write for WhatsApp: short lines, *single-asterisk* bold, no markdown headings, no tables, no pipe characters.",
  "Lead with wins. Be precise, direct, and genuinely insightful - not a wall of numbers, not empty cheerleading.",
  "Never emit em dashes or en dashes; use a plain hyphen with spaces instead.",
  "Respond with ONLY the message - no preamble, no sign-off, no commentary about your process."
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

function runClaude(
  args: string[],
  options: { stdin?: string; signal?: AbortSignal; timeoutMs: number }
): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const { signal } = options;

    if (signal?.aborted) {
      resolve({ exitCode: CANCELLED_EXIT_CODE, stdout: "", stderr: "Insight generation cancelled" });
      return;
    }

    // Neutral cwd so the CLI does not load this repo's CLAUDE.md or project
    // settings into the analysis context.
    const child = spawn(rankConfig.claudeCliBin, args, {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    const stdout = createCappedBuffer(rankConfig.maxOutputBytes);
    const stderr = createCappedBuffer(rankConfig.maxOutputBytes);

    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let timeoutKillHandle: NodeJS.Timeout | undefined;
    let cancelKillHandle: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const finish = (result: ClaudeResult) => {
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

    const cancelledResult = (): ClaudeResult => ({
      exitCode: CANCELLED_EXIT_CODE,
      stdout: stdout.value,
      stderr: `${stderr.value}\nInsight generation cancelled`.trim()
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      timeoutKillHandle = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          exitCode: 124,
          stdout: stdout.value,
          stderr: `${stderr.value}\nInsight generation timed out after ${options.timeoutMs}ms`
        });
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
        finish({
          exitCode: 124,
          stdout: stdout.value,
          stderr: `${stderr.value}\nInsight generation timed out after ${options.timeoutMs}ms`
        });
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

/**
 * Failures worth degrading gracefully on rather than treating as broken.
 *
 * A usage-limit hit on the Max plan is expected occasionally and should leave
 * the prompt on disk for manual use, not mark the report as an error.
 */
export function isTransientClaudeFailure(result: ClaudeResult): boolean {
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

export function stripEnclosingFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

export async function getClaudeStatus(): Promise<{ available: boolean; message: string }> {
  const result = await runClaude(["--version"], { timeoutMs: 15000 });

  if (result.exitCode !== 0) {
    return {
      available: false,
      message: result.stderr || "Claude Code CLI is not available on the PATH."
    };
  }

  return {
    available: true,
    message: `Claude Code ready (${result.stdout.trim()}), model ${rankConfig.insightModel}.`
  };
}

async function runWithSystemPrompt(prompt: string, systemPrompt: string, signal?: AbortSignal): Promise<string> {
  const result = await runClaude(
    ["-p", "--model", rankConfig.insightModel, "--output-format", "text", "--system-prompt", systemPrompt],
    { stdin: prompt, signal, timeoutMs: rankConfig.insightTimeoutMs }
  );

  if (result.exitCode !== 0) {
    const reason = result.stderr.trim() || `Claude exited with code ${result.exitCode}`;
    throw new Error(
      isTransientClaudeFailure(result)
        ? `Claude is temporarily unavailable: ${reason}. The prompt was saved - retry shortly.`
        : reason
    );
  }

  const text = result.stdout.trim();
  if (!text) {
    throw new Error("Claude returned no text output.");
  }

  return stripEnclosingFence(text);
}

/** Generate the detailed report. Returns the Markdown, or throws with the CLI's reason. */
export async function generateInsightMarkdown(prompt: string, signal?: AbortSignal): Promise<string> {
  return runWithSystemPrompt(prompt, ANALYST_SYSTEM_PROMPT, signal);
}

/** Generate the short WhatsApp brief. */
export async function generateBriefMarkdown(prompt: string, signal?: AbortSignal): Promise<string> {
  return runWithSystemPrompt(prompt, BRIEF_SYSTEM_PROMPT, signal);
}

const OPERATOR_SYSTEM_PROMPT = [
  "You are the operations supervisor for a local SEO tool, writing a short internal log entry.",
  "You are NOT a coding agent and you take NO actions - fixes and escalations are already decided by code.",
  "You are given a health snapshot, the findings, and what was auto-fixed. Interpret them: in 2-4 plain",
  "sentences say how the system is doing and what (if anything) the operator should pay attention to.",
  "Only use facts you were given; never invent a number or a problem.",
  "If there is a durable lesson worth remembering across runs, add one final line starting exactly with 'NOTE: '.",
  "Never use em dashes or en dashes. Respond with only the log entry - no preamble."
].join(" ");

/** The Operator's reasoning pass: language only, never actions. Best-effort. */
export async function runOperatorReasoning(prompt: string, signal?: AbortSignal): Promise<string> {
  return runWithSystemPrompt(prompt, OPERATOR_SYSTEM_PROMPT, signal);
}
