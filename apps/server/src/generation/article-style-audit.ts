export type ArticleStyleIssue = {
  code:
    | "forbidden-sentence-start"
    | "repeated-section-opener"
    | "repeated-topic-opener"
    | "repeated-sentence-pattern"
    | "h3-paragraph-count"
    | "repeated-bullet-opener";
  section: string;
  message: string;
  evidence: string[];
};

export type ArticleStyleAudit = {
  issues: ArticleStyleIssue[];
  sentenceCount: number;
  h3Count: number;
};

type Section = {
  level: number;
  heading: string;
  body: string;
};

const forbiddenSentenceStarts = new Set(["the", "a", "that", "those", "this", "it"]);
const topicRoleTerms = new Set([
  "broker",
  "dispatcher",
  "shipper",
  "carrier",
  "driver",
  "fleet",
  "manager",
  "customer",
  "buyer",
  "seller",
  "vendor",
  "provider",
  "platform",
  "software",
  "system",
  "tool",
  "role",
  "responsibility",
  "feature",
  "direct",
  "indirect",
  "entity",
  "service",
  "company",
  "team",
  "user"
]);
const stopWords = new Set([
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
const patternVerbs = new Set([
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
const ignoredOpeners = new Set([
  "and",
  "but",
  "or",
  "so",
  "yes",
  "no",
  "in",
  "on",
  "at",
  "of",
  "to",
  "with",
  "from"
]);

function normalizeText(value: string) {
  return value
    .replace(/[*_`>#]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(value: string) {
  if (value.length > 4 && value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }

  return value;
}

function tokenize(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^[^a-z0-9]+/i, "")
    .split(/\s+/)
    .map((word) => singularize(word.replace(/[^a-z0-9-]/g, "")))
    .filter(Boolean);
}

function normalizeOpener(value: string, wordCount: number) {
  return tokenize(value)
    .slice(0, wordCount)
    .join(" ")
    .trim();
}

function getSectionTopicTerms(heading: string) {
  return new Set(tokenize(heading).filter((word) => word.length > 2 && !stopWords.has(word)));
}

function getOpeningTopic(sentence: string, heading: string) {
  const sectionTerms = getSectionTopicTerms(heading);
  const openingTokens = tokenize(sentence).slice(0, 4);
  const topicToken =
    openingTokens.find((token) => topicRoleTerms.has(token)) ??
    openingTokens.find((token) => sectionTerms.has(token) && token.length > 3);

  return topicToken ?? "";
}

function getOpeningPattern(sentence: string) {
  const openingTokens = tokenize(sentence).slice(0, 4);
  const verbIndex = openingTokens.findIndex((token, index) => index > 0 && index <= 2 && patternVerbs.has(token));

  if (verbIndex === -1) {
    return "";
  }

  return `subject-${openingTokens[verbIndex]}`;
}

function splitIntoSentences(markdown: string) {
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

function parseLeafSections(markdown: string) {
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

function parseH3Blocks(markdown: string) {
  const lines = markdown.split("\n");
  const blocks: Array<{ heading: string; parentHeading: string; paragraphCount: number }> = [];
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

    const paragraphs: string[] = [];
    let current: string[] = [];

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^#{2,3}\s+/.test(lines[cursor])) {
        break;
      }

      const trimmed = lines[cursor].trim();
      if (!trimmed) {
        if (current.length) {
          paragraphs.push(current.join(" "));
          current = [];
        }
        continue;
      }

      if (!trimmed.startsWith("|") && !trimmed.startsWith("-")) {
        current.push(trimmed);
      }
    }

    if (current.length) {
      paragraphs.push(current.join(" "));
    }

    blocks.push({
      heading: match[1].trim(),
      parentHeading,
      paragraphCount: paragraphs.length
    });
  }

  return blocks;
}

function isFaqBlock(block: { heading: string; parentHeading: string }) {
  return /\b(faq|faqs|frequently asked|common questions)\b/i.test(`${block.parentHeading} ${block.heading}`);
}

function addRepeatedOpenerIssues(sections: Section[], issues: ArticleStyleIssue[]) {
  sections.forEach((section) => {
    const sentences = splitIntoSentences(section.body);
    const openers = sentences.map((sentence) => ({
      sentence,
      firstWord: normalizeOpener(sentence, 1),
      firstTwoWords: normalizeOpener(sentence, 2),
      firstThreeWords: normalizeOpener(sentence, 3),
      topic: getOpeningTopic(sentence, section.heading),
      pattern: getOpeningPattern(sentence)
    }));

    openers.forEach((opener) => {
      if (forbiddenSentenceStarts.has(opener.firstWord)) {
        issues.push({
          code: "forbidden-sentence-start",
          section: section.heading,
          message: `Rewrite the sentence opening "${opener.firstWord}".`,
          evidence: [opener.sentence]
        });
      }
    });

    for (let index = 0; index < openers.length; index += 1) {
      const window = openers.slice(index, index + 5);
      [1, 2, 3].forEach((wordCount) => {
        const key = wordCount === 1 ? "firstWord" : wordCount === 2 ? "firstTwoWords" : "firstThreeWords";
        const grouped = new Map<string, string[]>();

        window.forEach((opener) => {
          const value = opener[key];
          if (!value || ignoredOpeners.has(value)) {
            return;
          }

          grouped.set(value, [...(grouped.get(value) ?? []), opener.sentence]);
        });

        grouped.forEach((evidence, value) => {
          if (evidence.length > 2 && !issues.some((issue) => issue.code === "repeated-section-opener" && issue.section === section.heading && issue.message.includes(`"${value}"`))) {
            issues.push({
              code: "repeated-section-opener",
              section: section.heading,
              message: `More than two nearby sentences start with "${value}".`,
              evidence: evidence.slice(0, 4)
            });
          }
        });
      });
    }

    for (let index = 0; index < openers.length; index += 1) {
      const window = openers.slice(index, index + 5);
      const topicGroups = new Map<string, string[]>();
      const patternGroups = new Map<string, string[]>();

      window.forEach((opener) => {
        if (opener.topic && !ignoredOpeners.has(opener.topic)) {
          topicGroups.set(opener.topic, [...(topicGroups.get(opener.topic) ?? []), opener.sentence]);
        }

        if (opener.pattern) {
          patternGroups.set(opener.pattern, [...(patternGroups.get(opener.pattern) ?? []), opener.sentence]);
        }
      });

      topicGroups.forEach((evidence, value) => {
        if (evidence.length > 2 && !issues.some((issue) => issue.code === "repeated-topic-opener" && issue.section === section.heading && issue.message.includes(`"${value}"`))) {
          issues.push({
            code: "repeated-topic-opener",
            section: section.heading,
            message: `More than two nearby sentences start with the same topic or role concept "${value}".`,
            evidence: evidence.slice(0, 4)
          });
        }
      });

      patternGroups.forEach((evidence, value) => {
        if (evidence.length > 2 && !issues.some((issue) => issue.code === "repeated-sentence-pattern" && issue.section === section.heading && issue.message.includes(`"${value}"`))) {
          issues.push({
            code: "repeated-sentence-pattern",
            section: section.heading,
            message: `More than two nearby sentences use the same opening grammar pattern "${value}".`,
            evidence: evidence.slice(0, 4)
          });
        }
      });
    }
  });
}

function addBulletPatternIssues(sections: Section[], issues: ArticleStyleIssue[]) {
  sections.forEach((section) => {
    const bulletOpeners = section.body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => normalizeOpener(line.replace(/^-\s+/, "").replace(/^\*\*[^*]+:\*\*\s*/, ""), 2))
      .filter(Boolean);

    const counts = new Map<string, number>();
    bulletOpeners.forEach((opener) => counts.set(opener, (counts.get(opener) ?? 0) + 1));

    counts.forEach((count, opener) => {
      if (count > 2) {
        issues.push({
          code: "repeated-bullet-opener",
          section: section.heading,
          message: `More than two bullets start with "${opener}".`,
          evidence: [opener]
        });
      }
    });
  });
}

export function auditArticleStyle(markdown: string): ArticleStyleAudit {
  const sections = parseLeafSections(markdown);
  const issues: ArticleStyleIssue[] = [];
  const h3Blocks = parseH3Blocks(markdown);

  h3Blocks.forEach((block) => {
    if (isFaqBlock(block) && block.paragraphCount > 1) {
      issues.push({
        code: "h3-paragraph-count",
        section: block.heading,
        message: `FAQ H3 answers should use one concise paragraph. Found ${block.paragraphCount}.`,
        evidence: [block.heading]
      });
      return;
    }

    if (!isFaqBlock(block) && block.paragraphCount !== 2) {
      issues.push({
        code: "h3-paragraph-count",
        section: block.heading,
        message: `Non-FAQ H3 sections must have exactly two short paragraphs. Found ${block.paragraphCount}.`,
        evidence: [block.heading]
      });
    }
  });

  addRepeatedOpenerIssues(sections, issues);
  addBulletPatternIssues(sections, issues);

  return {
    issues,
    sentenceCount: sections.reduce((total, section) => total + splitIntoSentences(section.body).length, 0),
    h3Count: h3Blocks.length
  };
}

export function renderArticleStyleAuditReport(audit: ArticleStyleAudit) {
  if (audit.issues.length === 0) {
    return [
      "# Article Style Audit",
      "",
      "No sentence-opening diversity or H3 structure issues found.",
      "",
      `Sentence count: ${audit.sentenceCount}`,
      `H3 count: ${audit.h3Count}`
    ].join("\n");
  }

  return [
    "# Article Style Audit",
    "",
    `Issues found: ${audit.issues.length}`,
    `Sentence count: ${audit.sentenceCount}`,
    `H3 count: ${audit.h3Count}`,
    "",
    ...audit.issues.map((issue, index) =>
      [
        `## ${index + 1}. ${issue.code}`,
        "",
        `Section: ${issue.section}`,
        "",
        issue.message,
        "",
        "Evidence:",
        ...issue.evidence.map((item) => `- ${item}`)
      ].join("\n")
    )
  ].join("\n\n");
}

export function renderArticleStyleRepairPrompt(markdown: string, audit: ArticleStyleAudit) {
  return [
    "You are repairing a Markdown article after a deterministic editorial style audit.",
    "",
    "Preserve the article meaning, headings, semantic SEO entities, examples, and structure unless a heading body must be adjusted to satisfy the audit.",
    "",
    "Repair only the issues listed in the audit:",
    "- Rewrite sentence openings that begin with the, a, that, those, this, or it.",
    "- Break repeated nearby sentence-openers, repeated topic-first openings, and repeated opening grammar patterns by starting with context, condition, outcome, contrast, or the operational object.",
    "- Keep important entities present, but move them inside sentences instead of always starting with them.",
    "- Make every non-FAQ H3 body exactly two short paragraphs: definition or clarification first, then data, function, impact, or decision value.",
    "- Keep FAQ H3 answers to one concise paragraph, usually 1 to 2 sentences.",
    "- Do not add a separate transition paragraph after an H3 before the next H2.",
    "- Vary bullet grammar if the audit flags repeated bullet openings.",
    "",
    "Return only the repaired article in Markdown.",
    "",
    renderArticleStyleAuditReport(audit),
    "",
    "# Article To Repair",
    "",
    markdown
  ].join("\n");
}
