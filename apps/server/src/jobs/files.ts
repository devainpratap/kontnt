import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ArticleIntake, CompetitorResearch, WorkflowStep } from "@semantic-seo/shared";

export type JobPaths = {
  root: string;
  inputDir: string;
  promptDir: string;
  outputDir: string;
  handoffDir: string;
  exportDir: string;
  intakeFile: string;
  competitorResearchFile: string;
  semanticMapFile: string;
  outlineFile: string;
  approvedOutlineFile: string;
  draftFile: string;
  finalOptimizedFile: string;
  markdownExportFile: string;
  htmlExportFile: string;
  docxExportFile: string;
};

export function buildJobPaths(jobPath: string): JobPaths {
  return {
    root: jobPath,
    inputDir: join(jobPath, "input"),
    promptDir: join(jobPath, "prompts"),
    outputDir: join(jobPath, "outputs"),
    handoffDir: join(jobPath, "handoffs"),
    exportDir: join(jobPath, "exports"),
    intakeFile: join(jobPath, "input", "brief.json"),
    competitorResearchFile: join(jobPath, "input", "competitor-research.json"),
    semanticMapFile: join(jobPath, "outputs", "semantic-map.md"),
    outlineFile: join(jobPath, "outputs", "outline.md"),
    approvedOutlineFile: join(jobPath, "outputs", "approved-outline.md"),
    draftFile: join(jobPath, "outputs", "draft.md"),
    finalOptimizedFile: join(jobPath, "outputs", "final-optimized-blog.md"),
    markdownExportFile: join(jobPath, "exports", "final-article.md"),
    htmlExportFile: join(jobPath, "exports", "final-article.html"),
    docxExportFile: join(jobPath, "exports", "final-article.docx")
  };
}

export async function ensureJobDirs(paths: JobPaths) {
  await Promise.all([
    mkdir(paths.inputDir, { recursive: true }),
    mkdir(paths.promptDir, { recursive: true }),
    mkdir(paths.outputDir, { recursive: true }),
    mkdir(paths.handoffDir, { recursive: true }),
    mkdir(paths.exportDir, { recursive: true })
  ]);
}

export async function writeJsonFile(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeMarkdownFile(path: string, value: string) {
  await writeFile(path, value.trimEnd() + "\n", "utf8");
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
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

export function getOutputPathForStep(paths: JobPaths, stepName: WorkflowStep) {
  switch (stepName) {
    case "semantic-map":
      return paths.semanticMapFile;
    case "outline":
      return paths.outlineFile;
    case "draft":
      return paths.draftFile;
    case "final-optimize":
      return paths.finalOptimizedFile;
    case "approve-outline":
      return paths.approvedOutlineFile;
  }
}

export function getPromptSnapshotPath(paths: JobPaths, stepName: WorkflowStep) {
  switch (stepName) {
    case "semantic-map":
      return join(paths.promptDir, "01-semantic-analysis.md");
    case "outline":
      return join(paths.promptDir, "02-outline-generation.md");
    case "draft":
      return join(paths.promptDir, "03-blog-draft.md");
    case "final-optimize":
      return join(paths.promptDir, "04-final-optimization.md");
    case "approve-outline":
      return join(paths.promptDir, "approved-outline.md");
  }
}

export function getHandoffPath(paths: JobPaths, stepName: WorkflowStep) {
  return join(paths.handoffDir, `${stepName}-handoff.md`);
}

export function renderArticleBrief(intake: ArticleIntake) {
  const optionalConstraints = [
    intake.brandContext ? ["Brand context:", intake.brandContext].join("\n") : null,
    intake.attributes.length ? ["Attributes:", intake.attributes.map((item) => `- ${item}`).join("\n")].join("\n") : null,
    intake.anchorKeywords.length ? ["Anchor keywords:", intake.anchorKeywords.map((item) => `- ${item}`).join("\n")].join("\n") : null,
    intake.internalLinks.length ? ["Internal links:", intake.internalLinks.map((item) => `- ${item}`).join("\n")].join("\n") : null,
    intake.preferredCtas.length ? ["Preferred CTAs:", intake.preferredCtas.map((item) => `- ${item}`).join("\n")].join("\n") : null
  ].filter(Boolean);

  return [
    `Title: ${intake.title}`,
    `Target keyword: ${intake.targetKeyword || "Not provided"}`,
    `Audience: ${intake.intendedAudience || "Infer from the title, target keyword, and competitor research."}`,
    `Search intent: ${intake.searchIntent || "Infer from the title, target keyword, and competitor research."}`,
    `Tone: ${intake.tone || "clear, expert, practical"}`,
    `Target word count: ${intake.targetWordCount}`,
    "",
    "Inference instructions:",
    "- The user only has to provide title, target keyword, and ranking URLs.",
    "- Infer audience, search intent, topic attributes, entities, use cases, comparison angles, and likely reader objections from the SERP evidence.",
    "- Do not ask for missing optional fields. Treat missing fields as signals to infer, not as blockers.",
    "",
    "Optional user constraints:",
    optionalConstraints.length ? optionalConstraints.join("\n\n") : "None provided. Infer the missing context from the title, keyword, and competitor research."
  ].join("\n");
}

export function renderCompetitorContext(intake: ArticleIntake) {
  return [
    "Top-ranking URLs:",
    intake.topRankingUrls.length ? intake.topRankingUrls.map((item) => `- ${item}`).join("\n") : "- None provided",
    "",
    "Competitor notes:",
    intake.competitorNotes || "Not provided"
  ].join("\n");
}

export function renderExtractedCompetitorContext(research: CompetitorResearch) {
  const sections = research.competitors.map((competitor, index) => {
    if (competitor.status === "failed") {
      return [
        `Competitor ${index + 1}: ${competitor.url}`,
        `Extraction status: failed`,
        `Error: ${competitor.errorMessage || "Unknown extraction error"}`
      ].join("\n");
    }

    return [
      `Competitor ${index + 1}: ${competitor.url}`,
      `Extraction source: ${competitor.extractionSource || "unknown"}`,
      `Title: ${competitor.title || "Not found"}`,
      `Meta description: ${competitor.metaDescription || "Not found"}`,
      "Headings:",
      competitor.headings.length ? competitor.headings.map((heading) => `- ${heading}`).join("\n") : "- None extracted",
      "",
      "Excerpt:",
      competitor.excerpt || "No readable article excerpt extracted."
    ].join("\n");
  });

  return [
    "Extracted competitor research:",
    sections.length ? sections.join("\n\n") : "No competitor pages were extracted.",
    "",
    "Original source URLs:",
    research.sourceUrls.length ? research.sourceUrls.map((item) => `- ${item}`).join("\n") : "- None provided"
  ].join("\n");
}

export function renderEntityContext(intake: ArticleIntake) {
  return [
    "Main entities:",
    intake.mainEntities.length
      ? intake.mainEntities.map((item) => `- ${item}`).join("\n")
      : "- None provided. Infer the core entities from the title, target keyword, competitor headings, and extracted article excerpts.",
    "",
    "Secondary entities:",
    intake.secondaryEntities.length
      ? intake.secondaryEntities.map((item) => `- ${item}`).join("\n")
      : "- None provided. Infer supporting entities, attributes, tools, benefits, risks, and adjacent concepts from the SERP evidence."
  ].join("\n");
}
