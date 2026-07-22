import { getKeyTerms, getSectionTopicTerms, isFaqBlock, modalVerbs, patternVerbs, splitIntoSentences, stopWords, tokenize } from "./parsing";
import { isMatrackPitchCandidate } from "./pitch";
import type { ArticleStyleIssue, H2Section, H3Block } from "./types";

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

function getH2OpeningSyntaxPattern(sentence: string) {
  const tokens = tokenize(sentence).slice(0, 10);
  const genericFrames = [
    ["improve", "when"],
    ["work", "by"],
    ["matter", "because"],
    ["depend", "on"],
    ["start", "with"],
    ["come", "from"],
    ["become", "easier"],
    ["become", "more"]
  ];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const frame = genericFrames.find(([verb, connector]) => tokens[index] === verb && tokens[index + 1] === connector);
    if (frame) {
      return `concept ${frame[0]} ${frame[1]}`;
    }
  }

  return "";
}

export function addH2OpeningPatternIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
  const openingRows = h2Sections
    .filter((section) => !/\b(faq|faqs|frequently asked|common questions|final thoughts)\b/i.test(section.heading))
    .map((section) => {
      const openingSentence = splitIntoSentences(section.body)[0] ?? "";
      return {
        section,
        openingSentence,
        pattern: getH2OpeningPattern(openingSentence),
        syntaxPattern: getH2OpeningSyntaxPattern(openingSentence)
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

  const syntaxGrouped = new Map<string, Array<{ section: H2Section; openingSentence: string }>>();
  openingRows.forEach((row) => {
    if (!row.syntaxPattern) {
      return;
    }

    syntaxGrouped.set(row.syntaxPattern, [...(syntaxGrouped.get(row.syntaxPattern) ?? []), row]);
  });

  syntaxGrouped.forEach((rows, pattern) => {
    if (rows.length >= 3) {
      rows.forEach((row) => {
        issues.push({
          code: "h2-opening-pattern",
          section: row.section.heading,
          message: `Three or more H2 sections share the generic opening frame "${pattern}". Rewrite some openings with outcome-first, condition-first, or concrete-detail-first framing.`,
          evidence: [row.openingSentence]
        });
      });
    }
  });
}

function isExcludedFromH2PatternAudit(section: H2Section) {
  return /\b(faq|faqs|frequently asked|common questions|final thoughts)\b/i.test(section.heading) || isMatrackPitchCandidate(section);
}

function h2OpeningEchoesHeading(section: H2Section) {
  const openingSentence = splitIntoSentences(section.body)[0] ?? "";
  const headingTerms = getSectionTopicTerms(section.heading);
  const openingTokens = tokenize(openingSentence).slice(0, 8);
  const matchedTerms = openingTokens.filter((token) => headingTerms.has(token) && token.length > 2);

  if (matchedTerms.length < 2) {
    return false;
  }

  const firstMeaningfulOpening = openingTokens.find((token) => token.length > 2 && !stopWords.has(token));
  return Boolean(firstMeaningfulOpening && headingTerms.has(firstMeaningfulOpening));
}

export function addH2HeadingEchoDensityIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
  const rows = h2Sections
    .filter((section) => !isExcludedFromH2PatternAudit(section))
    .map((section) => ({
      section,
      openingSentence: splitIntoSentences(section.body)[0] ?? "",
      echoesHeading: h2OpeningEchoesHeading(section)
    }))
    .filter((row) => row.openingSentence);

  const echoes = rows.filter((row) => row.echoesHeading);
  if (rows.length >= 6 && echoes.length >= 5 && echoes.length / rows.length >= 0.45) {
    issues.push({
      code: "h2-heading-echo-density",
      section: "Article Structure",
      message: `${echoes.length}/${rows.length} non-FAQ H2 openings start by restating the heading topic. Vary some openings with outcome-first, condition-first, concrete-fact-first, or stakeholder-decision framing.`,
      evidence: echoes.slice(0, 8).map((row) => `${row.section.heading}: ${row.openingSentence}`)
    });
  }
}

export function addSectionOpeningClosingMirrorIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
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

export function addH3EchoDensityIssues(h3Blocks: H3Block[], issues: ArticleStyleIssue[]) {
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

function getH3SiblingOpeningKey(sentence: string) {
  const tokens = tokenize(sentence).slice(0, 4);
  const conditionStarter = tokens.find((token, index) => index === 0 && ["after", "before", "during", "when"].includes(token));

  if (conditionStarter) {
    return conditionStarter;
  }

  const firstMeaningful = tokens.find((token) => token.length > 3 && !stopWords.has(token));

  if (!firstMeaningful) {
    return "";
  }

  return firstMeaningful;
}

export function addH3SiblingOpenerRepetitionIssues(h3Blocks: H3Block[], issues: ArticleStyleIssue[]) {
  const byParent = new Map<string, Array<{ heading: string; firstSentence: string; opener: string }>>();

  h3Blocks
    .filter((block) => !isFaqBlock(block))
    .forEach((block) => {
      const firstSentence = block.sentences[0] ?? "";
      byParent.set(block.parentHeading, [
        ...(byParent.get(block.parentHeading) ?? []),
        {
          heading: block.heading,
          firstSentence,
          opener: getH3SiblingOpeningKey(firstSentence)
        }
      ]);
    });

  byParent.forEach((blocks, parentHeading) => {
    if (blocks.length < 3) {
      return;
    }

    const grouped = new Map<string, Array<{ heading: string; firstSentence: string }>>();
    blocks.forEach((block) => {
      if (!block.opener) {
        return;
      }

      grouped.set(block.opener, [...(grouped.get(block.opener) ?? []), block]);
    });

    grouped.forEach((rows, opener) => {
      if (rows.length >= 3) {
        issues.push({
          code: "h3-sibling-opener-repetition",
          section: parentHeading,
          message: `Three or more H3 sibling sections start with the same opener "${opener}". Vary the H3 openings so the subsection set does not feel templated.`,
          evidence: rows.slice(0, 6).map((row) => `${row.heading}: ${row.firstSentence}`)
        });
      }
    });
  });
}
