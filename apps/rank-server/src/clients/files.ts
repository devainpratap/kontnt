import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";

import { rankConfig } from "../config";
import { ApiError } from "../lib/api-error";

/**
 * Every path under clients/ is derived here. Nothing else in the codebase may
 * build a client file path by hand — mirrors buildJobPaths in ContentOS.
 */
export type ClientPaths = {
  root: string;
  gscDir: string;
  serpDir: string;
  insightsDir: string;
  promptsDir: string;
  exportsDir: string;
  clientFile: string;
};

export function buildClientPaths(clientPath: string): ClientPaths {
  return {
    root: clientPath,
    gscDir: join(clientPath, "gsc"),
    serpDir: join(clientPath, "serp"),
    insightsDir: join(clientPath, "insights"),
    promptsDir: join(clientPath, "prompts"),
    exportsDir: join(clientPath, "exports"),
    clientFile: join(clientPath, "client.json")
  };
}

export async function ensureClientDirs(paths: ClientPaths) {
  await Promise.all([
    mkdir(paths.gscDir, { recursive: true }),
    mkdir(paths.serpDir, { recursive: true }),
    mkdir(paths.insightsDir, { recursive: true }),
    mkdir(paths.promptsDir, { recursive: true }),
    mkdir(paths.exportsDir, { recursive: true })
  ]);
}

/**
 * Reject any path that escapes clientsRoot. Client folder names derive from
 * user-supplied names, so this is the guard that keeps a crafted name from
 * writing outside the workspace.
 */
export function assertWithinClientsRoot(candidate: string): string {
  const root = resolve(rankConfig.clientsRoot);
  const target = resolve(candidate);
  const rel = relative(root, target);

  if (target === root || rel.startsWith("..") || rel.startsWith(`..${sep}`) || resolve(root, rel) !== target) {
    throw new ApiError("Resolved path escapes the clients directory.", 400, "PATH_OUTSIDE_ROOT");
  }

  return target;
}

/**
 * Folder-safe slug. Strips everything outside [a-z0-9-] so path separators,
 * traversal sequences, and leading dots cannot survive into a folder name.
 */
export function slugifyClientName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || "client";
}

/**
 * Stable folder name for a keyword's SERP snapshots. Keywords contain spaces,
 * slashes, and non-ASCII text, so the raw phrase is never used as a path
 * segment; a short hash of the full identity is both safe and collision-free
 * enough at agency scale.
 */
export function keywordSnapshotDir(
  paths: ClientPaths,
  identity: { phrase: string; country: string; device: string; location?: string | null }
): string {
  const canonical = [
    identity.phrase.trim().toLowerCase(),
    identity.country.trim().toLowerCase(),
    identity.device,
    (identity.location ?? "").trim().toLowerCase()
  ].join("|");

  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return join(paths.serpDir, hash);
}

export async function writeJsonFile(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeMarkdownFile(path: string, value: string) {
  await writeFile(path, `${value.trimEnd()}\n`, "utf8");
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
