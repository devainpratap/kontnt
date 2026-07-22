import { normalizeOpener, normalizeText } from "./parsing";
import type { ArticleStyleIssue, Section } from "./types";

const editorialTableHeaders = new Set(["drafting caution", "verification notes", "editorial flag", "notes for writer", "caveat"]);

export function addBulletPatternIssues(sections: Section[], issues: ArticleStyleIssue[]) {
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

export function addTableIssues(sections: Section[], issues: ArticleStyleIssue[]) {
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
