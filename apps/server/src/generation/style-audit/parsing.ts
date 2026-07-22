import type { H2Section, H3Block, Section } from "./types";

export const stopWords = new Set([
  "about",
  "after",
  "again",
  "against",
  "and",
  "are",
  "before",
  "between",
  "but",
  "can",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "is",
  "its",
  "one",
  "should",
  "than",
  "that",
  "the",
  "their",
  "them",
  "these",
  "they",
  "this",
  "those",
  "to",
  "versus",
  "vs",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your"
]);

export const patternVerbs = new Set([
  "are",
  "can",
  "do",
  "does",
  "has",
  "have",
  "helps",
  "include",
  "includes",
  "is",
  "means",
  "need",
  "needs",
  "provide",
  "provides",
  "should",
  "use",
  "uses",
  "work",
  "works"
]);

export const modalVerbs = new Set(["can", "could", "should", "must", "need", "needs", "may", "might", "will", "would"]);

export function normalizeText(value: string) {
  return value
    .replace(/[*_`>#]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function singularize(value: string) {
  if (value.length > 4 && value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }

  return value;
}

export function tokenize(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^[^a-z0-9]+/i, "")
    .split(/\s+/)
    .map((word) => singularize(word.replace(/[^a-z0-9-]/g, "")))
    .filter(Boolean);
}

export function normalizeOpener(value: string, wordCount: number) {
  return tokenize(value)
    .slice(0, wordCount)
    .join(" ")
    .trim();
}

export function getKeyTerms(value: string) {
  return tokenize(value).filter((word) => word.length > 3 && !stopWords.has(word) && !modalVerbs.has(word));
}

export function getSectionTopicTerms(heading: string) {
  return new Set(tokenize(heading).filter((word) => word.length > 2 && !stopWords.has(word)));
}

export function splitIntoSentences(markdown: string) {
  const text = markdown
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith("|") &&
        !/^#{1,6}\s/.test(trimmed)
      );
    })
    .map((line) => line.replace(/^\s*[-*]\s+/, ""))
    .join(" ");

  return normalizeText(text)
    .split(/(?<=[.!?])\s+(?=(?:["'“”‘’(])?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function parseLeafSections(markdown: string) {
  const lines = markdown.split("\n");
  const sections: Section[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{2,3})\s+(.+)$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const level = match[1].length;
    const heading = match[2].trim();
    const bodyLines: string[] = [];

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = /^(#{2,3})\s+/.exec(lines[cursor]);
      if (nextHeading && (level === 2 || nextHeading[1].length <= level)) {
        break;
      }

      bodyLines.push(lines[cursor]);
    }

    const body = bodyLines.join("\n").trim();
    if (body) {
      sections.push({ level, heading, body });
    }
  }

  return sections;
}

export function parseH2Sections(markdown: string) {
  const lines = markdown.split("\n");
  const sections: H2Section[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+(.+)$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const bodyLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^##\s+/.test(lines[cursor])) {
        break;
      }

      bodyLines.push(lines[cursor]);
    }

    sections.push({ heading: match[1].trim(), body: bodyLines.join("\n").trim() });
  }

  return sections;
}

export function parseH3Blocks(markdown: string) {
  const lines = markdown.split("\n");
  const blocks: H3Block[] = [];
  let parentHeading = "";

  for (let index = 0; index < lines.length; index += 1) {
    const h2Match = /^##\s+(.+)$/.exec(lines[index]);
    if (h2Match) {
      parentHeading = h2Match[1].trim();
      continue;
    }

    const match = /^###\s+(.+)$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const bodyLines: string[] = [];

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^#{2,3}\s+/.test(lines[cursor])) {
        break;
      }

      const trimmed = lines[cursor].trim();
      if (!trimmed || trimmed.startsWith("|") || trimmed.startsWith("-")) {
        continue;
      }

      bodyLines.push(trimmed);
    }
    const sentences = splitIntoSentences(bodyLines.join("\n"));

    blocks.push({
      heading: match[1].trim(),
      parentHeading,
      sentenceCount: sentences.length,
      sentences
    });
  }

  return blocks;
}

export function isFaqBlock(block: { heading: string; parentHeading: string }) {
  return /\b(faq|faqs|frequently asked|common questions)\b/i.test(`${block.parentHeading} ${block.heading}`);
}
