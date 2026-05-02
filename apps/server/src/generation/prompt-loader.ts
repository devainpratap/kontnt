import { readFile } from "node:fs/promises";
import { join } from "node:path";

import matter from "gray-matter";

import type { ArticleIntake, CompetitorResearch, WorkflowStep } from "@semantic-seo/shared";

import { appConfig } from "../config";
import { renderArticleBrief, renderCompetitorContext, renderEntityContext, renderExtractedCompetitorContext } from "../jobs/files";

const stepTemplateMap: Record<Exclude<WorkflowStep, "approve-outline">, string> = {
  "semantic-map": "01-semantic-analysis.md",
  outline: "02-outline-generation.md",
  draft: "03-blog-draft.md",
  "final-optimize": "04-final-optimization.md"
};

export async function loadSystemRules() {
  const [contentQuality, semanticSeo] = await Promise.all([
    readFile(join(appConfig.promptsRoot, "system", "content-quality-rules.md"), "utf8"),
    readFile(join(appConfig.promptsRoot, "system", "semantic-seo-rules.md"), "utf8")
  ]);

  return {
    contentQuality,
    semanticSeo
  };
}

export async function renderStepPrompt(stepName: Exclude<WorkflowStep, "approve-outline">, context: Record<string, string>) {
  const templatePath = join(appConfig.promptsRoot, "steps", stepTemplateMap[stepName]);
  const raw = await readFile(templatePath, "utf8");
  const template = matter(raw).content;
  const rules = await loadSystemRules();

  return template
    .replace("{{CONTENT_QUALITY_RULES}}", rules.contentQuality.trim())
    .replace("{{SEMANTIC_SEO_RULES}}", rules.semanticSeo.trim())
    .replace("{{ARTICLE_BRIEF}}", context.ARTICLE_BRIEF)
    .replace("{{COMPETITOR_CONTEXT}}", context.COMPETITOR_CONTEXT ?? "")
    .replace("{{ENTITY_CONTEXT}}", context.ENTITY_CONTEXT ?? "")
    .replace("{{SEMANTIC_MAP}}", context.SEMANTIC_MAP ?? "")
    .replace("{{RECENT_STRUCTURE_PATTERNS}}", context.RECENT_STRUCTURE_PATTERNS ?? "")
    .replace("{{APPROVED_OUTLINE}}", context.APPROVED_OUTLINE ?? "")
    .replace("{{DRAFT}}", context.DRAFT ?? "");
}

function normalizeUrls(urls: string[]) {
  return Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean))).sort();
}

function hasFreshCompetitorResearch(intake: ArticleIntake, research: CompetitorResearch | null) {
  if (!research) {
    return false;
  }

  const intakeUrls = normalizeUrls(intake.topRankingUrls);
  const extractedUrls = normalizeUrls(research.sourceUrls);

  return (
    intakeUrls.length > 0 &&
    intakeUrls.length === extractedUrls.length &&
    intakeUrls.every((url, index) => url === extractedUrls[index])
  );
}

export function buildSemanticPromptContext(intake: ArticleIntake, competitorResearch: CompetitorResearch | null = null) {
  const competitorContext =
    competitorResearch && hasFreshCompetitorResearch(intake, competitorResearch)
      ? [renderCompetitorContext(intake), "", renderExtractedCompetitorContext(competitorResearch)].join("\n")
      : renderCompetitorContext(intake);

  return {
    ARTICLE_BRIEF: renderArticleBrief(intake),
    COMPETITOR_CONTEXT: competitorContext,
    ENTITY_CONTEXT: renderEntityContext(intake)
  };
}
