import { load } from "cheerio";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

const MIN_READABLE_TEXT_LENGTH = 500;
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", () => undefined);

type ExtractedArticle = {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  textContent: string;
  extractionSource: "local-readability" | "jina-reader";
};

function buildJinaReaderUrl(url: string) {
  return `https://r.jina.ai/${url}`;
}

function parseJinaReaderText(url: string, markdown: string): ExtractedArticle {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const titleLine = lines.find((line) => line.toLowerCase().startsWith("title:"));
  const title = titleLine?.replace(/^title:\s*/i, "").trim() ?? "";
  const headings = lines
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, "").trim())
    .filter(Boolean);
  const contentStart = lines.findIndex((line) => line.toLowerCase() === "markdown content:");
  const contentLines = contentStart >= 0 ? lines.slice(contentStart + 1) : lines;

  return {
    url,
    title,
    metaDescription: "",
    headings,
    textContent: contentLines.join("\n").trim(),
    extractionSource: "jina-reader"
  };
}

async function extractWithJinaReader(url: string) {
  const response = await fetch(buildJinaReaderUrl(url), {
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent": "SemanticSEOContentWorkflow/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Jina Reader failed for ${url}: ${response.status}`);
  }

  return parseJinaReaderText(url, await response.text());
}

async function extractWithLocalReadability(url: string): Promise<ExtractedArticle> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "user-agent": "SemanticSEOContentWorkflow/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);
  const document = new JSDOM(html, { url, virtualConsole }).window.document;
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const textContent = article?.textContent?.trim() ?? "";

  return {
    url,
    title: $("title").first().text().trim() || article?.title || "",
    metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? "",
    headings: $("h1, h2, h3")
      .map((_, node) => $(node).text().trim())
      .get()
      .filter(Boolean),
    textContent,
    extractionSource: "local-readability"
  };
}

export async function extractArticleFromUrl(url: string) {
  try {
    const article = await extractWithLocalReadability(url);
    if (article.textContent.length >= MIN_READABLE_TEXT_LENGTH) {
      return article;
    }
  } catch {
    // Fall through to the reader fallback below.
  }

  return extractWithJinaReader(url);
}
