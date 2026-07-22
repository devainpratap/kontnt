import { spawn } from "node:child_process";
import { relative } from "node:path";

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

// Accumulates decoded output while enforcing a byte cap so a runaway Codex
// process cannot exhaust memory. Once the cap is hit we append a single marker
// and drop any further chunks.
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

// Non-zero exit code used for an externally cancelled Codex run. Distinct from
// the timeout code (124) so cancellations can be told apart in logs; it is not
// classified as a transient failure (see isTransientCodexFailure), so it is
// never retried.
const CANCELLED_EXIT_CODE = 130;

function runCommand(args: string[], options: { cwd?: string; stdin?: string; signal?: AbortSignal } = {}) {
  return new Promise<CommandResult>((resolve) => {
    const { signal } = options;

    // Fast path: aborted before we spawn anything. Resolve once with a
    // cancellation result and never launch a child process.
    if (signal?.aborted) {
      resolve({
        exitCode: CANCELLED_EXIT_CODE,
        stdout: "",
        stderr: "Codex step cancelled"
      });
      return;
    }

    const child = spawn(appConfig.codexBin, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_QUIET_MODE: "1"
      }
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

    // Single resolution guard: whichever of close / error / timeout / abort
    // fires first wins, and every timer + listener is torn down so the timeout
    // and cancellation paths compose without double-resolving or leaking.
    const finish = (result: CommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (timeoutKillHandle) {
        clearTimeout(timeoutKillHandle);
      }
      if (cancelKillHandle) {
        clearTimeout(cancelKillHandle);
      }
      if (signal && abortListener) {
        signal.removeEventListener("abort", abortListener);
      }
      resolve(result);
    };

    const cancelledResult = (): CommandResult => ({
      exitCode: CANCELLED_EXIT_CODE,
      stdout: stdout.value,
      stderr: `${stderr.value}\nCodex step cancelled`.trim()
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalate to SIGKILL if the child ignores the graceful signal, and make
      // sure we still resolve even if the process never emits `close`.
      timeoutKillHandle = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          exitCode: 124,
          stdout: stdout.value,
          stderr: `${stderr.value}\nCodex step timed out after ${appConfig.codexTimeoutMs}ms`
        });
      }, KILL_GRACE_MS);
    }, appConfig.codexTimeoutMs);

    if (signal) {
      // External cancellation reuses the same SIGTERM→SIGKILL kill path as the
      // timeout and resolves exactly once with a cancellation result.
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

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.append(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.append(chunk);
    });

    child.on("error", () => {
      finish({
        exitCode: 127,
        stdout: stdout.value,
        stderr: "Codex CLI was not found on the PATH."
      });
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
          stderr: `${stderr.value}\nCodex step timed out after ${appConfig.codexTimeoutMs}ms`
        });
        return;
      }

      finish({
        exitCode: exitCode ?? 1,
        stdout: stdout.value,
        stderr: stderr.value
      });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }

    child.stdin.end();
  });
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isTransientCodexFailure(result: CommandResult) {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();

  return (
    combined.includes("stream disconnected") ||
    combined.includes("transport channel closed") ||
    combined.includes("failed to refresh available models") ||
    combined.includes("error sending request") ||
    combined.includes("http/request failed")
  );
}

export async function getCodexStatus(): Promise<ProviderStatus> {
  const versionResult = await runCommand(["--version"]);
  if (versionResult.exitCode !== 0) {
    return {
      available: false,
      authenticated: false,
      message: versionResult.stderr || "Codex CLI is not available."
    };
  }

  const authResult = await runCommand(["login", "status"]);
  const authText = `${authResult.stdout}\n${authResult.stderr}`.toLowerCase();
  const authenticated =
    authResult.exitCode === 0 &&
    (authText.includes("authenticated: yes") ||
      authText.includes("logged in using chatgpt") ||
      authText.includes("logged in using an api key"));

  return {
    available: true,
    authenticated,
    message: authenticated ? "Codex CLI is available and authenticated." : "Codex CLI is available but not authenticated."
  };
}

export async function runCodexStep(options: {
  cwd: string;
  outputPath: string;
  prompt: string;
  signal?: AbortSignal;
}) {
  const relativeOutputPath = relative(options.cwd, options.outputPath);
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox",
    appConfig.codexSandbox,
    "--skip-git-repo-check",
    "-C",
    options.cwd,
    "-o",
    relativeOutputPath,
    "-"
  ];

  if (appConfig.codexModel) {
    args.splice(1, 0, "-m", appConfig.codexModel);
  }

  const attempts: CommandResult[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await runCommand(args, {
      cwd: options.cwd,
      stdin: options.prompt,
      signal: options.signal
    });
    attempts.push(result);

    // A cancellation is non-zero and never matches isTransientCodexFailure, so
    // it returns immediately here without consuming a retry.
    if (result.exitCode === 0 || !isTransientCodexFailure(result)) {
      return result;
    }

    // Do not burn the transient-retry backoff on a run that has since been
    // aborted; surface the last result immediately instead.
    if (attempt < 2 && !options.signal?.aborted) {
      await delay(2500);
    }
  }

  return {
    exitCode: attempts.at(-1)?.exitCode ?? 1,
    stdout: attempts.map((attempt, index) => `Attempt ${index + 1} stdout:\n${attempt.stdout}`).join("\n\n"),
    stderr: attempts.map((attempt, index) => `Attempt ${index + 1} stderr:\n${attempt.stderr}`).join("\n\n")
  };
}
