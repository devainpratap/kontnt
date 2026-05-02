import { readFile } from "node:fs/promises";
import { join } from "node:path";

import matter from "gray-matter";

import type { WorkflowStep } from "@semantic-seo/shared";

import { appConfig } from "../config";

export async function renderManualHandoff(stepName: WorkflowStep, prompt: string) {
  const raw = await readFile(join(appConfig.promptsRoot, "steps", "05-chatgpt-handoff.md"), "utf8");
  const template = matter(raw).content;

  return template
    .replace("{{STEP_NAME}}", stepName)
    .replace("{{PROMPT}}", prompt);
}

