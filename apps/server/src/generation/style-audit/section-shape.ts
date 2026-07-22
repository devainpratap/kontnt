import { isMatrackPitchCandidate } from "./pitch";
import type { ArticleStyleIssue, H2Section } from "./types";

export function addPreH2ContentIssues(markdown: string, issues: ArticleStyleIssue[]) {
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

function getH2SectionShape(section: H2Section) {
  if (/\b(faq|faqs|frequently asked|common questions)\b/i.test(section.heading)) {
    return "faq";
  }

  if (/^final thoughts$/i.test(section.heading)) {
    return "final-thoughts";
  }

  if (isMatrackPitchCandidate(section)) {
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

export function addRepeatedSectionShapeIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
  const articleSections = h2Sections.filter((section) => !/\b(faq|faqs|frequently asked|common questions|final thoughts)\b/i.test(section.heading));
  const shapeRows = articleSections.map((section) => ({
    section,
    shape: getH2SectionShape(section),
    h3Count: (section.body.match(/^###\s+/gm) ?? []).length,
    bulletCount: (section.body.match(/^\s*[-*]\s+\*\*[^*]+:\*\*/gm) ?? []).length
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

  const repeatedCountGroups = [
    {
      label: "H3",
      rows: shapeRows.filter((row) => row.h3Count >= 3),
      getCount: (row: (typeof shapeRows)[number]) => row.h3Count
    },
    {
      label: "bullet",
      rows: shapeRows.filter((row) => row.bulletCount >= 4),
      getCount: (row: (typeof shapeRows)[number]) => row.bulletCount
    }
  ];

  repeatedCountGroups.forEach(({ label, rows, getCount }) => {
    const grouped = new Map<number, typeof rows>();
    rows.forEach((row) => grouped.set(getCount(row), [...(grouped.get(getCount(row)) ?? []), row]));

    grouped.forEach((groupRows, count) => {
      if (groupRows.length >= 3) {
        issues.push({
          code: "repeated-section-count-pattern",
          section: "Article Structure",
          message: `Three or more H2 sections use exactly ${count} ${label}${count === 1 ? "" : "s"}. Vary section depth when reader intent allows it.`,
          evidence: groupRows.map((row) => row.section.heading).slice(0, 8)
        });
      }
    });
  });
}
