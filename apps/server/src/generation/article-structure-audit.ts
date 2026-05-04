import type { ArticleIntake } from "@semantic-seo/shared";

export type ArticleStructureIssue = {
  code: "comparison-outline-order" | "mixed-section-purpose";
  message: string;
  evidence: string[];
};

export type ArticleStructureAudit = {
  articleType: "comparison" | "standard";
  entities: { first: string; second: string } | null;
  issues: ArticleStructureIssue[];
};

type OutlineEntry = {
  index: number;
  text: string;
};

const sectionPurposeMatchers = {
  definition: /\b(what is|who is|definition|meaning|overview)\b/i,
  responsibilities: /\b(responsibil\w*|features?|roles?|tasks?|dut\w*|what .* do|services?)\b/i,
  process: /\b(how .* works?|process|workflow|steps?)\b/i,
  comparison: /\b(vs\.?|versus|differences?|different|compare|comparison)\b/i,
  legal: /\b(legal|compliance|authority|license|licence|liability|contract|bond|regulation|permit)\b/i,
  decision: /\b(choose|which one|right for|better|best for|when should|who should|decision)\b/i,
  redFlags: /\b(red flag|risk|mistake|avoid|warning)\b/i,
  metrics: /\b(kpi|metric|benchmark|measure)\b/i,
  faq: /\b(faq|faqs|frequently asked|common questions)\b/i,
  conclusion: /\b(conclusion|final thoughts|summary)\b/i
};

const highLevelOutlineBuckets = new Set([
  "article outline",
  "working title",
  "suggested meta description",
  "key takeaways",
  "one-line introduction",
  "macro section",
  "micro section",
  "kpi decision support",
  "buying guide / decision framework",
  "product or brand integration",
  "faqs",
  "final thoughts",
  "section structure plan",
  "verification notes"
]);

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[*_`>#]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEntity(value: string) {
  return normalize(value)
    .replace(/^(what is|who is|how does|how do|which is|guide to)\s+/i, "")
    .replace(/\b(which one should you choose|what s the difference|what is the difference|key differences|comparison|guide|explained)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractComparisonEntities(intake: Pick<ArticleIntake, "title" | "targetKeyword">) {
  const source = `${intake.title} ${intake.targetKeyword}`.trim();
  const patterns = [
    /(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:[:?|-]|$)/i,
    /difference(?:s)?\s+between\s+(.+?)\s+and\s+(.+?)(?:[:?|-]|$)/i,
    /compare\s+(.+?)\s+and\s+(.+?)(?:[:?|-]|$)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) {
      continue;
    }

    const first = cleanEntity(match[1]);
    const second = cleanEntity(match[2]);
    if (first && second && first !== second) {
      return { first, second };
    }
  }

  return null;
}

function parseOutlineEntries(markdown: string) {
  return markdown
    .split("\n")
    .map((line, index): OutlineEntry | null => {
      const trimmed = line.trim();
      const headingMatch = /^#{1,5}\s+(.+)$/.exec(trimmed);
      const h2PlanMatch = /^(?:[-*]|\d+\.)\s+(?:H2\s*:\s*)?(.+)$/i.exec(trimmed);
      const text = headingMatch?.[1] ?? h2PlanMatch?.[1] ?? "";

      if (!text) {
        return null;
      }

      const normalized = normalize(text);
      if (!normalized || highLevelOutlineBuckets.has(normalized)) {
        return null;
      }

      return { index, text: text.trim() };
    })
    .filter((entry): entry is OutlineEntry => Boolean(entry));
}

function entityTokens(entity: string) {
  return normalize(entity)
    .split(" ")
    .filter((token) => token.length > 2);
}

function containsEntity(text: string, entity: string) {
  const normalizedText = normalize(text);
  const tokens = entityTokens(entity);
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function findEntry(entries: OutlineEntry[], predicate: (entry: OutlineEntry) => boolean) {
  return entries.find(predicate);
}

function hasPurpose(text: string, purpose: keyof typeof sectionPurposeMatchers) {
  return sectionPurposeMatchers[purpose].test(text);
}

function findPurposeEntry(entries: OutlineEntry[], purpose: keyof typeof sectionPurposeMatchers) {
  return findEntry(entries, (entry) => hasPurpose(entry.text, purpose));
}

function findEntityPurposeEntry(entries: OutlineEntry[], entity: string, purpose: keyof typeof sectionPurposeMatchers) {
  return findEntry(entries, (entry) => containsEntity(entry.text, entity) && hasPurpose(entry.text, purpose));
}

function addOrderIssue(issues: ArticleStructureIssue[], message: string, evidence: string[]) {
  issues.push({
    code: "comparison-outline-order",
    message,
    evidence
  });
}

function addComparisonOrderIssues(entries: OutlineEntry[], entities: { first: string; second: string }, issues: ArticleStructureIssue[]) {
  const firstDefinition = findEntityPurposeEntry(entries, entities.first, "definition");
  const secondDefinition = findEntityPurposeEntry(entries, entities.second, "definition");
  const firstResponsibilities = findEntityPurposeEntry(entries, entities.first, "responsibilities");
  const secondResponsibilities = findEntityPurposeEntry(entries, entities.second, "responsibilities");
  const comparison = findPurposeEntry(entries, "comparison");
  const legal = findPurposeEntry(entries, "legal");
  const decision = findPurposeEntry(entries, "decision");
  const faqs = findPurposeEntry(entries, "faq");
  const conclusion = findPurposeEntry(entries, "conclusion");

  if (!firstDefinition || !secondDefinition) {
    addOrderIssue(issues, "Comparison outlines must define both entities independently before comparing them.", [
      `Entity A: ${entities.first}`,
      `Entity B: ${entities.second}`
    ]);
  }

  if (comparison && (!firstDefinition || !secondDefinition || firstDefinition.index > comparison.index || secondDefinition.index > comparison.index)) {
    addOrderIssue(issues, "The first comparison section appears before both entities are clearly defined.", [comparison.text]);
  }

  if (comparison && (!firstResponsibilities || !secondResponsibilities || firstResponsibilities.index > comparison.index || secondResponsibilities.index > comparison.index)) {
    addOrderIssue(issues, "Responsibilities or key features for both entities must appear before key differences.", [comparison.text]);
  }

  if (legal && (!firstResponsibilities || !secondResponsibilities || legal.index < firstResponsibilities.index || legal.index < secondResponsibilities.index)) {
    addOrderIssue(issues, "Legal or compliance sections should appear after role clarity and responsibility sections.", [legal.text]);
  }

  if (decision && comparison && decision.index < comparison.index) {
    addOrderIssue(issues, "Decision guidance should appear after the key comparison section.", [decision.text, comparison.text]);
  }

  if (faqs && comparison && faqs.index < comparison.index) {
    addOrderIssue(issues, "FAQs should stay near the end after the comparison is complete.", [faqs.text]);
  }

  if (conclusion && comparison && conclusion.index < comparison.index) {
    addOrderIssue(issues, "The conclusion should summarize the comparison after the decision logic is established.", [conclusion.text]);
  }
}

function addMixedPurposeIssues(entries: OutlineEntry[], issues: ArticleStructureIssue[]) {
  entries.forEach((entry) => {
    const purposes = Object.entries(sectionPurposeMatchers)
      .filter(([purpose]) => purpose !== "faq" && purpose !== "conclusion")
      .filter(([, matcher]) => matcher.test(entry.text))
      .map(([purpose]) => purpose);

    if (purposes.length > 2) {
      issues.push({
        code: "mixed-section-purpose",
        message: "A section heading appears to mix too many purposes. Split definition, responsibility, legal, comparison, and decision guidance into separate sections.",
        evidence: [`${entry.text} (${purposes.join(", ")})`]
      });
    }
  });
}

export function auditArticleStructure(intake: Pick<ArticleIntake, "title" | "targetKeyword">, markdown: string): ArticleStructureAudit {
  const entities = extractComparisonEntities(intake);
  const entries = parseOutlineEntries(markdown);
  const issues: ArticleStructureIssue[] = [];

  if (entities) {
    addComparisonOrderIssues(entries, entities, issues);
  }

  addMixedPurposeIssues(entries, issues);

  return {
    articleType: entities ? "comparison" : "standard",
    entities,
    issues
  };
}

export function renderArticleStructureAuditReport(audit: ArticleStructureAudit) {
  if (audit.issues.length === 0) {
    return [
      "# Article Structure Audit",
      "",
      `Article type: ${audit.articleType}`,
      audit.entities ? `Comparison entities: ${audit.entities.first} / ${audit.entities.second}` : "Comparison entities: none",
      "",
      "No comparison-order or section-purpose issues found."
    ].join("\n");
  }

  return [
    "# Article Structure Audit",
    "",
    `Article type: ${audit.articleType}`,
    audit.entities ? `Comparison entities: ${audit.entities.first} / ${audit.entities.second}` : "Comparison entities: none",
    `Issues found: ${audit.issues.length}`,
    "",
    ...audit.issues.map((issue, index) =>
      [
        `## ${index + 1}. ${issue.code}`,
        "",
        issue.message,
        "",
        "Evidence:",
        ...issue.evidence.map((item) => `- ${item}`)
      ].join("\n")
    )
  ].join("\n\n");
}

export function renderArticleStructureRepairPrompt(intake: Pick<ArticleIntake, "title" | "targetKeyword">, markdown: string, audit: ArticleStructureAudit) {
  return [
    "You are repairing a generated Semantic SEO article outline after a deterministic structure audit.",
    "",
    "Preserve the topic, search intent, semantic coverage, and useful section ideas, but rebuild the order where the audit requires it.",
    "",
    "For comparison articles, follow one of these structures:",
    "",
    "Option 1:",
    "1. What is Entity A?",
    "2. What is Entity B?",
    "3. Key features or responsibilities of each",
    "4. Key differences between Entity A and Entity B",
    "5. FAQs",
    "6. Conclusion",
    "",
    "Option 2:",
    "1. What is Entity A?",
    "2. Key features or responsibilities of Entity A",
    "3. What is Entity B?",
    "4. Key features or responsibilities of Entity B",
    "5. Key differences between Entity A and Entity B",
    "6. Which one should you choose?",
    "7. FAQs",
    "8. Conclusion",
    "",
    "Rules:",
    "- Define both entities independently before comparison tables, legal concerns, decision sections, or buying guidance.",
    "- Keep each H2 focused on one dominant purpose: definition, responsibilities, process, comparison, legal/compliance, decision guidance, red flags, metrics/KPIs, FAQs, or conclusion.",
    "- Place legal and compliance clarification after role clarity.",
    "- Place decision guidance after the comparison.",
    "- Keep FAQs near the end and conclusion last.",
    "- Preserve dynamic section structure notes and sentence-opening guardrails from the original outline.",
    "",
    "Return only the repaired outline in Markdown.",
    "",
    "Article brief:",
    `Title: ${intake.title}`,
    `Target keyword: ${intake.targetKeyword || "Not provided"}`,
    "",
    renderArticleStructureAuditReport(audit),
    "",
    "# Outline To Repair",
    "",
    markdown
  ].join("\n");
}
