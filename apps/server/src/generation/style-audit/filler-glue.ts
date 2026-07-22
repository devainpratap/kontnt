import { splitIntoSentences, tokenize } from "./parsing";
import type { ArticleStyleIssue, Section } from "./types";

// Sentences longer than this many words are flagged for splitting. Loosened from a
// strict 30-word cap to reduce false positives on legitimately detailed sentences
// while still catching genuinely overloaded ones.
export const LONG_SENTENCE_WORD_LIMIT = 35;

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

const semanticGluePatterns = [
  { label: "context", pattern: /\bcontext\b/gi, threshold: 10 },
  { label: "events", pattern: /\bevents?\b/gi, threshold: 12 },
  { label: "alerts", pattern: /\balerts?\b/gi, threshold: 12 },
  { label: "review", pattern: /\breviews?\b|\breviewing\b/gi, threshold: 14 },
  { label: "workflow", pattern: /\bworkflows?\b/gi, threshold: 7 }
];

const fillerLanguagePatterns = [
  { label: "clear", pattern: /\bclear(?:ly)?\b/gi, threshold: 5 },
  { label: "stronger", pattern: /\bstronger\b/gi, threshold: 4 },
  { label: "easier", pattern: /\beasier\b/gi, threshold: 4 },
  { label: "lack of", pattern: /\black of\b/gi, threshold: 3 },
  { label: "well defined", pattern: /\bwell[-\s]defined\b/gi, threshold: 2 },
  { label: "clear understanding", pattern: /\bclear understanding\b/gi, threshold: 2 },
  { label: "built for", pattern: /\bbuilt for\b/gi, threshold: 3 },
  { label: "designed for", pattern: /\bdesigned for\b/gi, threshold: 3 },
  { label: "effective", pattern: /\beffective(?:ly)?\b/gi, threshold: 5 },
  { label: "efficient", pattern: /\befficient(?:ly)?\b/gi, threshold: 5 },
  { label: "use of", pattern: /\buse of\b/gi, threshold: 5 },
  { label: "greater", pattern: /\bgreater\b/gi, threshold: 4 },
  { label: "starting", pattern: /\bstarting\b/gi, threshold: 4 },
  { label: "choosing", pattern: /\bchoosing\b/gi, threshold: 4 },
  { label: "common", pattern: /\bcommon\b/gi, threshold: 8 },
  { label: "consistent", pattern: /\bconsistent(?:ly)?\b/gi, threshold: 5 },
  { label: "well-", pattern: /\bwell-[a-z]+\b/gi, threshold: 4 }
];

export function addBannedPhraseIssues(sections: Section[], issues: ArticleStyleIssue[]) {
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

export function addBridgeAndLengthIssues(sections: Section[], issues: ArticleStyleIssue[]) {
  sections.forEach((section) => {
    splitIntoSentences(section.body).forEach((sentence) => {
      const wordCount = tokenize(sentence).length;

      if (wordCount > LONG_SENTENCE_WORD_LIMIT) {
        issues.push({
          code: "long-sentence",
          section: section.heading,
          message: `Split sentences over ${LONG_SENTENCE_WORD_LIMIT} words. Found ${wordCount} words.`,
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

export function addRepeatedCaveatIssues(markdown: string, issues: ArticleStyleIssue[]) {
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

export function addRepeatedAbstractPhraseIssues(markdown: string, issues: ArticleStyleIssue[]) {
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

export function addSemanticGlueOveruseIssues(markdown: string, issues: ArticleStyleIssue[]) {
  semanticGluePatterns.forEach(({ label, pattern, threshold }) => {
    const matches = Array.from(markdown.matchAll(pattern)).map((match) => match[0]);
    if (matches.length >= threshold) {
      issues.push({
        code: "semantic-glue-overuse",
        section: "Article Body",
        message: `The generic connective term "${label}" appears ${matches.length} times. Keep necessary uses, but replace repetitive glue with concrete objects, actions, roles, records, or decisions.`,
        evidence: matches.slice(0, 8)
      });
    }
  });
}

export function addFillerLanguageOveruseIssues(markdown: string, issues: ArticleStyleIssue[]) {
  fillerLanguagePatterns.forEach(({ label, pattern, threshold }) => {
    const matches = Array.from(markdown.matchAll(pattern)).map((match) => match[0]);
    if (matches.length >= threshold) {
      issues.push({
        code: "filler-language-overuse",
        section: "Article Body",
        message: `The AI-pattern filler term "${label}" appears ${matches.length} times. Keep useful instances, but replace repetitive uses with specific meaning.`,
        evidence: matches.slice(0, 8)
      });
    }
  });
}
