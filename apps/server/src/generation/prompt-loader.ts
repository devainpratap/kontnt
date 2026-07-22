import { readFile } from "node:fs/promises";
import { join } from "node:path";

import matter from "gray-matter";

import type { ArticleIntake, CompetitorResearch, WorkflowStep } from "@semantic-seo/shared";

import { appConfig } from "../config";
import { renderArticleBrief, renderCompetitorContext, renderEntityContext, renderExtractedCompetitorContext } from "../jobs/files";
import { isFleetTopic } from "./style-audit/topic-scope";

// Placeholder injected in place of the Matrack quality rules for non-fleet topics so
// the {{MATRACK_QUALITY_RULES}} token still resolves without pushing a fleet/Matrack
// pitch or capability list onto an unrelated article.
const GENERIC_QUALITY_NOTE = [
  "## Topic Scope",
  "",
  "This article is not a Matrack, fleet, trucking, telematics, or logistics topic.",
  "Do not add a vendor pitch section, a Matrack capability list, or fleet-specific",
  "capabilities. Follow the general content-quality and semantic-SEO rules above and",
  "keep the article focused on its own subject."
].join("\n");

const stepTemplateMap: Record<Exclude<WorkflowStep, "approve-outline">, string> = {
  "semantic-map": "01-semantic-analysis.md",
  outline: "02-outline-generation.md",
  draft: "03-blog-draft.md",
  "final-optimize": "04-final-optimization.md"
};

export async function loadSystemRules() {
  const [contentQuality, semanticSeo, matrackQuality] = await Promise.all([
    readFile(join(appConfig.promptsRoot, "system", "content-quality-rules.md"), "utf8"),
    readFile(join(appConfig.promptsRoot, "system", "semantic-seo-rules.md"), "utf8"),
    readFile(join(appConfig.promptsRoot, "system", "matrack-quality-rules.md"), "utf8")
  ]);

  return {
    contentQuality,
    semanticSeo,
    matrackQuality
  };
}

export async function renderStepPrompt(stepName: Exclude<WorkflowStep, "approve-outline">, context: Record<string, string>) {
  const templatePath = join(appConfig.promptsRoot, "steps", stepTemplateMap[stepName]);
  const raw = await readFile(templatePath, "utf8");
  const template = matter(raw).content;
  const rules = await loadSystemRules();

  // Decide fleet scope from the intake-derived signals already present in the context
  // (article brief carries title + target keyword; entity context carries entities).
  // Only fleet/trucking/telematics/logistics topics get the Matrack quality rules.
  const topicSignal = [context.ARTICLE_BRIEF, context.ENTITY_CONTEXT].filter(Boolean).join("\n");
  const matrackRules = isFleetTopic(topicSignal) ? rules.matrackQuality.trim() : GENERIC_QUALITY_NOTE;

  return template
    .replace("{{CONTENT_QUALITY_RULES}}", rules.contentQuality.trim())
    .replace("{{SEMANTIC_SEO_RULES}}", rules.semanticSeo.trim())
    .replace("{{MATRACK_QUALITY_RULES}}", matrackRules)
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
