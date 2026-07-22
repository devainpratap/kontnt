import { getSectionTopicTerms, normalizeOpener, patternVerbs, splitIntoSentences, tokenize } from "./parsing";
import type { ArticleStyleIssue, Section } from "./types";

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

export function addRepeatedOpenerIssues(sections: Section[], issues: ArticleStyleIssue[]) {
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
