import { addBulletPatternIssues, addTableIssues } from "./bullets-tables";
import {
  addBannedPhraseIssues,
  addBridgeAndLengthIssues,
  addFillerLanguageOveruseIssues,
  addRepeatedAbstractPhraseIssues,
  addRepeatedCaveatIssues,
  addSemanticGlueOveruseIssues
} from "./filler-glue";
import {
  addH2HeadingEchoDensityIssues,
  addH2OpeningPatternIssues,
  addH3EchoDensityIssues,
  addH3SiblingOpenerRepetitionIssues,
  addSectionOpeningClosingMirrorIssues
} from "./heading-echo";
import { addRepeatedOpenerIssues } from "./openers";
import { isFaqBlock, parseH2Sections, parseH3Blocks, parseLeafSections, splitIntoSentences } from "./parsing";
import { addPitchIssues } from "./pitch";
import { addPreH2ContentIssues, addRepeatedSectionShapeIssues } from "./section-shape";
import { isFleetTopic } from "./topic-scope";
import type { ArticleStyleAudit } from "./types";

export type { ArticleStyleAudit, ArticleStyleIssue } from "./types";
export { isFleetTopic } from "./topic-scope";

// Non-FAQ H3 chunk sentence bounds. The upper bound was loosened so genuinely useful
// 4 to 5 sentence chunks are not flagged as too long.
const NON_FAQ_H3_MIN_SENTENCES = 2;
const NON_FAQ_H3_MAX_SENTENCES = 5;
const FAQ_H3_MIN_SENTENCES = 1;
const FAQ_H3_MAX_SENTENCES = 3;

export function auditArticleStyle(markdown: string): ArticleStyleAudit {
  const sections = parseLeafSections(markdown);
  const issues: ArticleStyleAudit["issues"] = [];
  const h3Blocks = parseH3Blocks(markdown);
  const h2Sections = parseH2Sections(markdown);

  h3Blocks.forEach((block) => {
    if (isFaqBlock(block) && (block.sentenceCount < FAQ_H3_MIN_SENTENCES || block.sentenceCount > FAQ_H3_MAX_SENTENCES)) {
      issues.push({
        code: "h3-sentence-count",
        section: block.heading,
        message: `FAQ H3 answers should use ${FAQ_H3_MIN_SENTENCES} to ${FAQ_H3_MAX_SENTENCES} concise sentences. Found ${block.sentenceCount}.`,
        evidence: block.sentences.length ? block.sentences : [block.heading]
      });
      return;
    }

    if (!isFaqBlock(block) && (block.sentenceCount < NON_FAQ_H3_MIN_SENTENCES || block.sentenceCount > NON_FAQ_H3_MAX_SENTENCES)) {
      issues.push({
        code: "h3-sentence-count",
        section: block.heading,
        message: `Non-FAQ H3 sections should have ${NON_FAQ_H3_MIN_SENTENCES} to ${NON_FAQ_H3_MAX_SENTENCES} sentences. Found ${block.sentenceCount}.`,
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

  // Matrack pitch/capability detectors only make sense for fleet/trucking/telematics/
  // logistics articles. Skip them entirely for unrelated topics so a non-fleet article
  // is never flagged against a pitch structure it can never satisfy.
  if (isFleetTopic(markdown)) {
    addPitchIssues(h2Sections, issues);
  }

  addRepeatedCaveatIssues(markdown, issues);
  addH2OpeningPatternIssues(h2Sections, issues);
  addH2HeadingEchoDensityIssues(h2Sections, issues);
  addSectionOpeningClosingMirrorIssues(h2Sections, issues);
  addH3EchoDensityIssues(h3Blocks, issues);
  addH3SiblingOpenerRepetitionIssues(h3Blocks, issues);
  addRepeatedSectionShapeIssues(h2Sections, issues);
  addRepeatedAbstractPhraseIssues(markdown, issues);
  addSemanticGlueOveruseIssues(markdown, issues);
  addFillerLanguageOveruseIssues(markdown, issues);

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
    "- Do not add an in-body H1 title. The article title lives in the YAML frontmatter or brief, and the first H2 is the entry point.",
    "- Break repeated nearby sentence-openers, repeated topic-first openings, and repeated opening grammar patterns by starting with context, condition, outcome, contrast, or the operational object.",
    "- Keep important entities present, but move them inside sentences instead of always starting with them.",
    "- Make every non-FAQ H3 body 2 to 5 sentences: function first, operational value second, optional use case or detail after.",
    "- Keep FAQ H3 answers concise and self-contained, usually 1 to 3 sentences.",
    "- Remove bridge sentences, editorial leak phrases, CTAs, exclamation marks, and marketing puffery.",
    "- Split sentences over 35 words.",
    "- Format bullets as `- **Term:** Explanation` when the audit flags bullet format.",
    "- Remove editorial/process table columns such as Drafting Caution, Verification Notes, Editorial Flag, Notes for Writer, or Caveat.",
    "- Vary bullet grammar if the audit flags repeated bullet openings.",
    "- Delete all pre-H2 content when the audit flags `pre-h2-content`; the first H2 must be the entry point.",
    "- If the audit flags `pitch-structure`, rewrite the Matrack pitch as exactly three prose paragraphs with no H3s, bullets, numbered lists, or tables.",
    "- If the audit flags `pitch-pricing-flexibility`, add both pricing context and flexibility context to the Matrack pitch without adding a CTA.",
    "- If the audit flags `repeated-caveat`, keep the first useful caveat and remove later repeated caveat phrasing while preserving any new variation factors.",
    "- If the audit flags `h2-opening-pattern`, rotate H2 opening sentence types so the same subject-plus-modal or subject-plus-verb pattern does not appear three or more times.",
    "- If the audit flags `h2-heading-echo-density`, keep direct answers but rewrite some H2 openings so they do not all begin by restating the heading topic.",
    "- If the audit flags `section-opening-closing-mirror`, rewrite the closing sentence with a specific operational implication, stakeholder decision, constraint, or applied value.",
    "- If the audit flags `h3-echo-density`, rewrite excess H3 openers with function-first, user/action-first, condition-first, outcome-first, or object/data-first phrasing.",
    "- If the audit flags `h3-sibling-opener-repetition`, rewrite sibling H3 openings so three or more do not start with the same word or frame.",
    "- If the audit flags `repeated-section-shape`, rebalance repeated H3-list sections into bullets, numbered steps, compact prose, or tables where reader intent allows.",
    "- If the audit flags `repeated-section-count-pattern`, vary the section depth so multiple H2 sections do not all use the same number of H3s or bullets unless the topic truly requires it.",
    "- If the audit flags `repeated-abstract-phrase`, replace later repeated abstract phrases with specific operational actions, records, roles, exceptions, or decisions.",
    "- If the audit flags `semantic-glue-overuse`, reduce repeated generic glue terms such as context, events, alerts, review, and workflow by naming the specific signal, file, role, action, or decision instead.",
    "- If the audit flags `filler-language-overuse`, replace repeated filler terms with precise nouns, verbs, constraints, or cause-effect details.",
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
