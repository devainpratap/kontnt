import type { CompetitorResearch, ExtractedCompetitor } from "@semantic-seo/shared";

import { extractArticleFromUrl } from "./article-extractor";

const MAX_EXCERPT_LENGTH = 4000;
const MAX_HEADINGS = 20;

function nowIso() {
  return new Date().toISOString();
}

function toExcerpt(textContent: string) {
  const normalized = textContent.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EXCERPT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_EXCERPT_LENGTH).trimEnd()}...`;
}

async function extractCompetitor(url: string): Promise<ExtractedCompetitor> {
  try {
    const article = await extractArticleFromUrl(url);

    return {
      url,
      status: "completed",
      title: article.title,
      metaDescription: article.metaDescription,
      headings: article.headings.slice(0, MAX_HEADINGS),
      textContent: article.textContent,
      excerpt: toExcerpt(article.textContent),
      errorMessage: null,
      extractionSource: article.extractionSource
    };
  } catch (error) {
    return {
      url,
      status: "failed",
      title: "",
      metaDescription: "",
      headings: [],
      textContent: "",
      excerpt: "",
      errorMessage: error instanceof Error ? error.message : "Unknown extraction error.",
      extractionSource: ""
    };
  }
}

export async function extractCompetitorResearch(urls: string[]): Promise<CompetitorResearch> {
  const normalizedUrls = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean)));
  const competitors: ExtractedCompetitor[] = [];

  for (const url of normalizedUrls) {
    competitors.push(await extractCompetitor(url));
  }

  return {
    generatedAt: nowIso(),
    sourceUrls: normalizedUrls,
    competitors
  };
}
