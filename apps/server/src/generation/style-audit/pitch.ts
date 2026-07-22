import type { ArticleStyleIssue, H2Section } from "./types";

export function isMatrackPitchCandidate(section: H2Section) {
  const heading = section.heading;
  const body = section.body;

  if (/\bmatrack\b/i.test(`${heading}\n${body}`)) {
    return true;
  }

  return /\bbest\b.*\b(solution|system|software|platform)\b/i.test(heading);
}

export function findMatrackPitchSection(h2Sections: H2Section[]) {
  const finalThoughtsIndex = h2Sections.findIndex((section) => /^final thoughts$/i.test(section.heading));
  const beforeFinal = finalThoughtsIndex === -1 ? h2Sections : h2Sections.slice(0, finalThoughtsIndex);
  const namedCandidate = [...beforeFinal].reverse().find((section) => isMatrackPitchCandidate(section));

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

export function addPitchIssues(h2Sections: H2Section[], issues: ArticleStyleIssue[]) {
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
