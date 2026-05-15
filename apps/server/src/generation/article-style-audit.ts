export type ArticleStyleIssue = {
  code:
    | "forbidden-sentence-start"
    | "repeated-section-opener"
    | "repeated-topic-opener"
    | "repeated-sentence-pattern"
    | "h3-sentence-count"
    | "repeated-bullet-opener"
    | "bullet-format"
    | "banned-phrase"
    | "bridge-sentence"
    | "long-sentence"
    | "table-editorial-column"
    | "pre-h2-content"
    | "pitch-structure"
    | "pitch-pricing-flexibility"
    | "repeated-caveat"
    | "h2-opening-pattern"
    | "section-opening-closing-mirror"
    | "h3-echo-density"
    | "repeated-section-shape"
    | "repeated-abstract-phrase";
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

type H2Section = {
  heading: string;
  body: string;
};

const forbiddenSentenceStarts = new Set(["the", "a", "that", "those", "this", "it"]);
const bannedPhrasePatterns = [
  /verify before publishing/i,
  /should be verified before publication/i,
  /before publishing this article/i,
  /before publication/i,
  /research needs to be read with care/i,
  /should not be stretched into stereotypes/i,
  /drafting caution/i,
  /source-specific verification/i,
  /claims require credible sources/i,
  /newer results should be verified/i,
  /before internal target setting/i,
  /this should be checked/i,
  /it is important to note that/i,
  /in today's (?:world|fast-paced world)/i,
  /in the modern era/i,
  /as we all know/i,
  /at the end of the day/i,
  /in this article we will/i,
  /\b(?:leverage|leverages|leveraging|utilize|utilizes|utilizing|empower|empowers|empowering|revolutionizes?|supercharges?|harnesses the power of|unlock the potential)\b/i,
  /\b(?:cutting-edge|revolutionary|game-changing|world-class|best-in-class)\b/i
];
const bridgeSentencePatterns = [
  /^once teams\b/i,
  /^once the\b/i,
  /^now that\b/i,
  /^with .{1,60} now\b/i,
  /^having established\b/i,
  /^as discussed above\b/i,
  /^building on\b/i,
  /^before we get to\b/i,
  /^now let's look at\b/i,
  /^moving forward to\b/i
];
const editorialTableHeaders = new Set(["drafting caution", "verification notes", "editorial flag", "notes for writer", "caveat"]);
const repeatedCaveatPatterns = [
  { label: "based on the manufacturer's definition", pattern: /based on the manufacturer['’]s definition/gi, threshold: 3 },
  { label: "exact wording can differ", pattern: /exact wording can differ/gi, threshold: 3 },
  { label: "exact assumptions can vary", pattern: /exact assumptions can vary/gi, threshold: 3 },
  { label: "depending on context", pattern: /depending on context/gi, threshold: 3 },
  { label: "varies by", pattern: /\bvaries by\b/gi, threshold: 4 }
];
const abstractPhrasePatterns = [
  { label: "one operating view", pattern: /\bone operating view\b/gi },
  { label: "route history", pattern: /\broute history\b/gi },
  { label: "service records", pattern: /\bservice records\b/gi },
  { label: "tracking records", pattern: /\btracking records\b/gi },
  { label: "data", pattern: /\bdata\b/gi },
  { label: "signals", pattern: /\bsignals\b/gi },
  { label: "records", pattern: /\brecords\b/gi },
  { label: "becomes easier", pattern: /\bbecomes easier\b/gi },
  { label: "becomes stronger", pattern: /\bbecomes stronger\b/gi },
  { label: "use those signals", pattern: /\buse those signals\b/gi },
  { label: "use those records", pattern: /\buse those records\b/gi },
  { label: "managers can", pattern: /\bmanagers can\b/gi },
  { label: "teams use", pattern: /\bteams use\b/gi }
];
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
const modalVerbs = new Set(["can", "could", "should", "must", "need", "needs", "may", "might", "will", "would"]);

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

function getKeyTerms(value: string) {
  return tokenize(value).filter((word) => word.length > 3 && !stopWords.has(word) && !modalVerbs.has(word));
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

function parseH2Sections(markdown: string) {
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

function parseH3Blocks(markdown: string) {
  const lines = markdown.split("\n");
  const blocks: Array<{ heading: string; parentHeading: string; sentenceCount: number; sentences: string[] }> = [];
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

function isFaqBlock(block: { heading: string; parentHeading: string }) {
  return /\b(faq|faqs|frequently asked|common questions)\b/i.test(`${block.parentHeading} ${block.heading}`);
}

function addPreH2ContentIssues(markdown: string, issues: ArticleStyleIssue[]) {
  const lines = markdown.split("\n");
  let bodyStart = 0;

  if (lines[0]?.trim() === "---") {
    const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closingIndex !== -1) {
      bodyStart = closingIndex + 1;
    }
  }

  const firstH2Index = lines.findIndex((line, index) => index >= bodyStart && /^##\s+/.test(line));
  if (firstH2Index === -1) {
    return;
  }

  const preH2Lines = lines.slice(bodyStart, firstH2Index).filter((line) => line.trim().length > 0);
  if (preH2Lines.length === 0) {
    return;
  }

  issues.push({
    code: "pre-h2-content",
    section: "Document Start",
    message: "Delete all content between YAML frontmatter or document start and the first H2.",
    evidence: preH2Lines.slice(0, 6)
  });
}

function findMatrackPitchSection(h2Sections: H2Section[]) {
  const finalThoughtsIndex = h2Sections.findIndex((section) => /^final thoughts$/i.test(section.heading));
  const beforeFinal = finalThoughtsIndex === -1 ? h2Sections : h2Sections.slice(0, finalThoughtsIndex);
  const namedCandidate = [...beforeFinal].reverse().find((section) =>
    /\b(matrack|best .*solution|best .*for|support)\b/i.test(section.heading)
  );

  if (namedCandidate) {
    return namedCandidate;
  }

  if (finalThoughtsIndex > 0) {
    const previous = h2Sections[finalThoughtsIndex - 1];
    if (/\b(faq|frequently asked questions)\b/i.test(previous.heading) && finalThoughtsIndex > 1) {
      return h2Sections[finalThoughtsIndex - 2];
    }

    return previous;
  }

  return undefined;
}

function countProseParagraphs(body: string) {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) =>
      paragraph.length > 0 &&
      !/^#{1,6}\s+/.test(paragraph) &&
      !/^[-*]\s+/.test(paragraph) &&
      !/^\d+\.\s+/.test(paragraph) &&
      !/^\|.+\|$/.test(paragraph)
    ).length;
}

function addPitchIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
  const pitch = findMatrackPitchSection(h2Sections);
  if (!pitch) {
    return;
  }

  const structuralEvidence = pitch.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^###\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^\|.+\|$/.test(line));
  const paragraphCount = countProseParagraphs(pitch.body);

  if (structuralEvidence.length > 0 || paragraphCount !== 3) {
    issues.push({
      code: "pitch-structure",
      section: pitch.heading,
      message: `Matrack pitch must be exactly 3 prose paragraphs with no H3s, bullets, numbered lists, or tables. Found ${paragraphCount} prose paragraphs.`,
      evidence: structuralEvidence.length ? structuralEvidence.slice(0, 6) : [`Prose paragraphs: ${paragraphCount}`]
    });
  }

  const hasPricing = /\b(affordable monthly plans|monthly plans|affordable pricing|flexible plans)\b/i.test(pitch.body);
  const hasFlexibility = /\b(no long-term contracts|no-contract|easy-install hardware|suitable for small fleets to large enterprises|scalable device options)\b/i.test(pitch.body);

  if (!hasPricing || !hasFlexibility) {
    issues.push({
      code: "pitch-pricing-flexibility",
      section: pitch.heading,
      message: "Matrack pitch must include both pricing context and flexibility context.",
      evidence: [
        hasPricing ? "Pricing context found." : "Missing pricing context.",
        hasFlexibility ? "Flexibility context found." : "Missing flexibility context."
      ]
    });
  }
}

function addRepeatedCaveatIssues(markdown: string, issues: ArticleStyleIssue[]) {
  repeatedCaveatPatterns.forEach(({ label, pattern, threshold }) => {
    const matches = Array.from(markdown.matchAll(pattern)).map((match) => match[0]);
    if (matches.length >= threshold) {
      issues.push({
        code: "repeated-caveat",
        section: "Article Body",
        message: `The caveat "${label}" appears ${matches.length} times. Keep the first useful instance and remove later repetitions.`,
        evidence: matches.slice(0, 5)
      });
    }
  });
}

function getH2OpeningPattern(sentence: string) {
  const tokens = tokenize(sentence).slice(0, 7);
  if (tokens.length < 3) {
    return "";
  }

  const modalIndex = tokens.findIndex((token, index) => index > 0 && index <= 3 && modalVerbs.has(token));
  if (modalIndex !== -1) {
    return `${tokens.slice(0, modalIndex).join(" ")} ${tokens[modalIndex]}`;
  }

  const verbIndex = tokens.findIndex((token, index) => index > 0 && index <= 2 && patternVerbs.has(token));
  if (verbIndex !== -1) {
    return `${tokens.slice(0, verbIndex).join(" ")} ${tokens[verbIndex]}`;
  }

  return tokens.slice(0, 3).join(" ");
}

function addH2OpeningPatternIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
  const openingRows = h2Sections
    .filter((section) => !/\b(faq|faqs|frequently asked|common questions|final thoughts)\b/i.test(section.heading))
    .map((section) => {
      const openingSentence = splitIntoSentences(section.body)[0] ?? "";
      return {
        section,
        openingSentence,
        pattern: getH2OpeningPattern(openingSentence)
      };
    })
    .filter((row) => row.openingSentence && row.pattern);

  const grouped = new Map<string, Array<{ section: H2Section; openingSentence: string }>>();
  openingRows.forEach((row) => {
    grouped.set(row.pattern, [...(grouped.get(row.pattern) ?? []), row]);
  });

  grouped.forEach((rows, pattern) => {
    if (rows.length >= 3) {
      rows.forEach((row) => {
        issues.push({
          code: "h2-opening-pattern",
          section: row.section.heading,
          message: rows.length >= 4
            ? `Critical: four or more H2 sections share the opening pattern "${pattern}".`
            : `Three or more H2 sections share the opening pattern "${pattern}".`,
          evidence: [row.openingSentence]
        });
      });
    }
  });
}

function addSectionOpeningClosingMirrorIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
  h2Sections
    .filter((section) => !/\b(faq|faqs|frequently asked|common questions|final thoughts)\b/i.test(section.heading))
    .forEach((section) => {
      const sentences = splitIntoSentences(section.body);
      if (sentences.length < 2) {
        return;
      }

      const firstSentence = sentences[0];
      const lastSentence = sentences[sentences.length - 1];
      const firstTerms = getKeyTerms(firstSentence);
      const lastTerms = new Set(getKeyTerms(lastSentence));

      if (firstTerms.length < 4) {
        return;
      }

      const overlappingTerms = firstTerms.filter((term) => lastTerms.has(term));
      const overlapRatio = overlappingTerms.length / firstTerms.length;

      if (overlapRatio >= 0.5 && overlappingTerms.length >= 3) {
        issues.push({
          code: "section-opening-closing-mirror",
          section: section.heading,
          message: "The section closing mirrors 50% or more of the opening sentence's key terms.",
          evidence: [firstSentence, lastSentence]
        });
      }
    });
}

function startsWithHeadingPhrase(heading: string, sentence: string) {
  const headingTokens = tokenize(heading);
  const sentenceTokens = tokenize(sentence);

  return headingTokens.length > 0 && headingTokens.every((token, index) => sentenceTokens[index] === token);
}

function addH3EchoDensityIssues(h3Blocks: Array<{ heading: string; parentHeading: string; sentenceCount: number; sentences: string[] }>, issues: ArticleStyleIssue[]) {
  const byParent = new Map<string, Array<{ heading: string; firstSentence: string; isEcho: boolean }>>();

  h3Blocks
    .filter((block) => !isFaqBlock(block))
    .forEach((block) => {
      const firstSentence = block.sentences[0] ?? "";
      byParent.set(block.parentHeading, [
        ...(byParent.get(block.parentHeading) ?? []),
        {
          heading: block.heading,
          firstSentence,
          isEcho: startsWithHeadingPhrase(block.heading, firstSentence)
        }
      ]);
    });

  byParent.forEach((blocks, parentHeading) => {
    if (blocks.length < 3) {
      return;
    }

    const echoes = blocks.filter((block) => block.isEcho);
    if (echoes.length / blocks.length > 0.5) {
      issues.push({
        code: "h3-echo-density",
        section: parentHeading,
        message: `More than half of this section's H3 openings repeat the H3 heading phrase (${echoes.length}/${blocks.length}).`,
        evidence: echoes.slice(0, 6).map((block) => `${block.heading}: ${block.firstSentence}`)
      });
    }
  });
}

function getH2SectionShape(section: H2Section) {
  if (/\b(faq|faqs|frequently asked|common questions)\b/i.test(section.heading)) {
    return "faq";
  }

  if (/^final thoughts$/i.test(section.heading)) {
    return "final-thoughts";
  }

  if (/\b(matrack|best .*solution|best .*for|support)\b/i.test(section.heading)) {
    return "matrack-pitch";
  }

  if (/^###\s+/m.test(section.body)) {
    return "h3-list";
  }

  if (/^\s*[-*]\s+/m.test(section.body)) {
    return "bullet-list";
  }

  if (/^\s*\d+\.\s+/m.test(section.body)) {
    return "numbered-list";
  }

  if (/^\|.+\|$/m.test(section.body)) {
    return "table";
  }

  return "prose";
}

function addRepeatedSectionShapeIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
  const articleSections = h2Sections.filter((section) => !/\b(faq|faqs|frequently asked|common questions|final thoughts)\b/i.test(section.heading));
  const shapeRows = articleSections.map((section) => ({
    section,
    shape: getH2SectionShape(section)
  }));
  const h3Rows = shapeRows.filter((row) => row.shape === "h3-list");

  if (h3Rows.length >= 3) {
    issues.push({
      code: "repeated-section-shape",
      section: "Article Structure",
      message: `H3-list format appears in ${h3Rows.length} H2 sections. Rebalance benefits, features, KPIs, rollout, or buying criteria where possible.`,
      evidence: h3Rows.map((row) => row.section.heading).slice(0, 8)
    });
  }

  for (let index = 0; index <= shapeRows.length - 3; index += 1) {
    const window = shapeRows.slice(index, index + 3);
    const shape = window[0].shape;
    if (shape !== "prose" && window.every((row) => row.shape === shape)) {
      issues.push({
        code: "repeated-section-shape",
        section: "Article Structure",
        message: `Three consecutive H2 sections use the same "${shape}" format.`,
        evidence: window.map((row) => row.section.heading)
      });
      break;
    }
  }
}

function addRepeatedAbstractPhraseIssues(markdown: string, issues: ArticleStyleIssue[]) {
  abstractPhrasePatterns.forEach(({ label, pattern }) => {
    const matches = Array.from(markdown.matchAll(pattern)).map((match) => match[0]);
    if (matches.length >= 4) {
      issues.push({
        code: "repeated-abstract-phrase",
        section: "Article Body",
        message: `The phrase "${label}" appears ${matches.length} times. Replace later instances with concrete operational detail where possible.`,
        evidence: matches.slice(0, 6)
      });
    }
  });
}

function addBannedPhraseIssues(sections: Section[], issues: ArticleStyleIssue[]) {
  sections.forEach((section) => {
    const sentences = splitIntoSentences(section.body);

    sentences.forEach((sentence) => {
      bannedPhrasePatterns.forEach((pattern) => {
        if (pattern.test(sentence)) {
          issues.push({
            code: "banned-phrase",
            section: section.heading,
            message: "Remove or rewrite banned editorial, bridge, hedge, puffery, or filler language.",
            evidence: [sentence]
          });
        }
      });
    });
  });
}

function addBridgeAndLengthIssues(sections: Section[], issues: ArticleStyleIssue[]) {
  sections.forEach((section) => {
    splitIntoSentences(section.body).forEach((sentence) => {
      const wordCount = tokenize(sentence).length;

      if (wordCount > 30) {
        issues.push({
          code: "long-sentence",
          section: section.heading,
          message: `Split sentences over 30 words. Found ${wordCount} words.`,
          evidence: [sentence]
        });
      }

      if (bridgeSentencePatterns.some((pattern) => pattern.test(sentence))) {
        issues.push({
          code: "bridge-sentence",
          section: section.heading,
          message: "Remove bridge sentences that refer to previous or upcoming sections.",
          evidence: [sentence]
        });
      }
    });
  });
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
    const bulletLines = section.body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "));
    const skipStrictFormat = /key takeaways|faq|faqs|frequently asked|common questions/i.test(section.heading);

    if (!skipStrictFormat) {
      bulletLines.forEach((line) => {
        if (!/^-\s+\*\*[^*]+:\*\*\s+\S/.test(line)) {
          issues.push({
            code: "bullet-format",
            section: section.heading,
            message: "Format bullets as `- **Term:** Explanation`.",
            evidence: [line]
          });
        }
      });
    }

    const bulletOpeners = bulletLines
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

function addTableIssues(sections: Section[], issues: ArticleStyleIssue[]) {
  sections.forEach((section) => {
    const lines = section.body.split("\n").map((line) => line.trim());
    lines.forEach((line) => {
      if (!/^\|.+\|$/.test(line) || /^[:|\-\s]+$/.test(line.replace(/\|/g, ""))) {
        return;
      }

      const headers = line
        .split("|")
        .map((item) => normalizeText(item).toLowerCase())
        .filter(Boolean);
      const hasEditorialHeader = headers.some((header) => editorialTableHeaders.has(header));

      if (hasEditorialHeader) {
        issues.push({
          code: "table-editorial-column",
          section: section.heading,
          message: "Remove editorial/process columns from tables.",
          evidence: [line]
        });
      }
    });
  });
}

export function auditArticleStyle(markdown: string): ArticleStyleAudit {
  const sections = parseLeafSections(markdown);
  const issues: ArticleStyleIssue[] = [];
  const h3Blocks = parseH3Blocks(markdown);
  const h2Sections = parseH2Sections(markdown);

  h3Blocks.forEach((block) => {
    if (isFaqBlock(block) && (block.sentenceCount < 1 || block.sentenceCount > 3)) {
      issues.push({
        code: "h3-sentence-count",
        section: block.heading,
        message: `FAQ H3 answers should use 1 to 3 concise sentences. Found ${block.sentenceCount}.`,
        evidence: block.sentences.length ? block.sentences : [block.heading]
      });
      return;
    }

    if (!isFaqBlock(block) && (block.sentenceCount < 2 || block.sentenceCount > 3)) {
      issues.push({
        code: "h3-sentence-count",
        section: block.heading,
        message: `Non-FAQ H3 sections must have 2 to 3 sentences. Found ${block.sentenceCount}.`,
        evidence: block.sentences.length ? block.sentences : [block.heading]
      });
    }
  });

  addBannedPhraseIssues(sections, issues);
  addBridgeAndLengthIssues(sections, issues);
  addRepeatedOpenerIssues(sections, issues);
  addBulletPatternIssues(sections, issues);
  addTableIssues(sections, issues);
  addPreH2ContentIssues(markdown, issues);
  addPitchIssues(h2Sections, issues);
  addRepeatedCaveatIssues(markdown, issues);
  addH2OpeningPatternIssues(h2Sections, issues);
  addSectionOpeningClosingMirrorIssues(h2Sections, issues);
  addH3EchoDensityIssues(h3Blocks, issues);
  addRepeatedSectionShapeIssues(h2Sections, issues);
  addRepeatedAbstractPhraseIssues(markdown, issues);

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
      "No sentence-opening, H3, bullet, table, or QA language issues found.",
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
    "- Make every non-FAQ H3 body 2 to 3 sentences: function first, operational value second, optional use case or detail third.",
    "- Keep FAQ H3 answers concise and self-contained, usually 1 to 3 sentences.",
    "- Remove bridge sentences, editorial leak phrases, CTAs, exclamation marks, and marketing puffery.",
    "- Split sentences over 30 words.",
    "- Format bullets as `- **Term:** Explanation` when the audit flags bullet format.",
    "- Remove editorial/process table columns such as Drafting Caution, Verification Notes, Editorial Flag, Notes for Writer, or Caveat.",
    "- Vary bullet grammar if the audit flags repeated bullet openings.",
    "- Delete all pre-H2 content when the audit flags `pre-h2-content`; the first H2 must be the entry point.",
    "- If the audit flags `pitch-structure`, rewrite the Matrack pitch as exactly three prose paragraphs with no H3s, bullets, numbered lists, or tables.",
    "- If the audit flags `pitch-pricing-flexibility`, add both pricing context and flexibility context to the Matrack pitch without adding a CTA.",
    "- If the audit flags `repeated-caveat`, keep the first useful caveat and remove later repeated caveat phrasing while preserving any new variation factors.",
    "- If the audit flags `h2-opening-pattern`, rotate H2 opening sentence types so the same subject-plus-modal or subject-plus-verb pattern does not appear three or more times.",
    "- If the audit flags `section-opening-closing-mirror`, rewrite the closing sentence with a specific operational implication, stakeholder decision, constraint, or applied value.",
    "- If the audit flags `h3-echo-density`, rewrite excess H3 openers with function-first, user/action-first, condition-first, outcome-first, or object/data-first phrasing.",
    "- If the audit flags `repeated-section-shape`, rebalance repeated H3-list sections into bullets, numbered steps, compact prose, or tables where reader intent allows.",
    "- If the audit flags `repeated-abstract-phrase`, replace later repeated abstract phrases with specific operational actions, records, roles, exceptions, or decisions.",
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
