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

function runCommand(args: string[], options: { cwd?: string; stdin?: string } = {}) {
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(appConfig.codexBin, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_QUIET_MODE: "1"
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      resolve({
        exitCode: 127,
        stdout,
        stderr: "Codex CLI was not found on the PATH."
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr
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
      stdin: options.prompt
    });
    attempts.push(result);

    if (result.exitCode === 0 || !isTransientCodexFailure(result)) {
      return result;
    }

    if (attempt < 2) {
      await delay(2500);
    }
  }

  return {
    exitCode: attempts.at(-1)?.exitCode ?? 1,
    stdout: attempts.map((attempt, index) => `Attempt ${index + 1} stdout:\n${attempt.stdout}`).join("\n\n"),
    stderr: attempts.map((attempt, index) => `Attempt ${index + 1} stderr:\n${attempt.stderr}`).join("\n\n")
  };
}
