import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditArticleStructure, extractComparisonEntities, renderArticleStructureRepairPrompt } from "./generation/article-structure-audit";

const comparisonIntake = {
  title: "Freight Broker vs Dispatcher: Key Differences",
  targetKeyword: "freight broker vs dispatcher"
};

describe("article structure audit", () => {
  it("extracts comparison entities from vs titles", () => {
    assert.deepEqual(extractComparisonEntities(comparisonIntake), {
      first: "freight broker",
      second: "dispatcher"
    });
  });

  it("flags comparison before independent entity explanations", () => {
    const outline = [
      "# Article Outline",
      "",
      "## Macro Section",
      "",
      "- H2: Key differences between freight brokers and dispatchers",
      "- H2: What is a freight broker?",
      "- H2: What is a dispatcher?",
      "- H2: FAQs",
      "- H2: Final Thoughts"
    ].join("\n");

    const audit = auditArticleStructure(comparisonIntake, outline);

    assert.equal(audit.articleType, "comparison");
    assert.ok(audit.issues.some((issue) => issue.code === "comparison-outline-order"));
  });

  it("allows comparison outlines that define and explain both entities first", () => {
    const outline = [
      "# Article Outline",
      "",
      "## Macro Section",
      "",
      "- H2: What is a freight broker?",
      "- H2: What responsibilities does a freight broker handle?",
      "- H2: What is a dispatcher?",
      "- H2: What responsibilities does a dispatcher handle?",
      "- H2: What are the key differences between freight brokers and dispatchers?",
      "- H2: Which one should you choose?",
      "- H2: FAQs",
      "- H2: Final Thoughts"
    ].join("\n");

    const audit = auditArticleStructure(comparisonIntake, outline);

    assert.equal(audit.issues.length, 0);
  });

  it("renders a structure repair prompt with comparison rules", () => {
    const outline = "# Outline\n\n- H2: Key differences between freight brokers and dispatchers";
    const audit = auditArticleStructure(comparisonIntake, outline);
    const prompt = renderArticleStructureRepairPrompt(comparisonIntake, outline, audit);

    assert.match(prompt, /deterministic structure audit/);
    assert.match(prompt, /Define both entities independently before comparison tables/);
    assert.match(prompt, /# Outline To Repair/);
  });
});
