import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditArticleStyle, renderArticleStyleRepairPrompt } from "./generation/article-style-audit";

describe("article style audit", () => {
  it("flags forbidden and repeated sentence openings inside sections", () => {
    const markdown = [
      "# Freight Broker Guide",
      "",
      "## What do freight brokers do?",
      "",
      "Freight brokers arrange transportation between shippers and carriers. Freight brokers source capacity for lanes. Freight brokers coordinate updates when a load changes. The process depends on timing.",
      "",
      "## FAQs",
      "",
      "### Is a broker the same as a dispatcher?",
      "",
      "No.",
      "",
      "Dispatchers work from the carrier side."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "repeated-section-opener" && issue.message.includes("freight broker")));
    assert.ok(audit.issues.some((issue) => issue.code === "forbidden-sentence-start" && issue.message.includes("\"the\"")));
  });

  it("requires exactly two paragraphs below each H3", () => {
    const markdown = [
      "# Fleet Guide",
      "",
      "## Components",
      "",
      "### Telematics",
      "",
      "Telematics captures vehicle diagnostics and location data.",
      "",
      "Maintenance teams use those signals for service planning.",
      "",
      "Extra transition paragraph creates a third H3 paragraph."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.deepEqual(
      audit.issues.filter((issue) => issue.code === "h3-paragraph-count").map((issue) => issue.section),
      ["Telematics"]
    );
  });

  it("does not flag a varied section with two-paragraph H3s", () => {
    const markdown = [
      "# Fleet Guide",
      "",
      "## Components",
      "",
      "Connected fleet systems link field activity to operational decisions.",
      "",
      "### Telematics",
      "",
      "Telematics captures diagnostics, mileage, and location data from vehicles.",
      "",
      "Maintenance planning becomes more reliable when those signals trigger service alerts before failures interrupt scheduled work.",
      "",
      "### Fuel management",
      "",
      "Fuel management connects purchases, idling, route choices, and vehicle assignments.",
      "",
      "Cost reviews become more precise when finance can compare fuel transactions with actual vehicle movement."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.equal(audit.issues.length, 0);
  });

  it("allows concise FAQ H3 answers", () => {
    const markdown = [
      "# Fleet Guide",
      "",
      "## FAQs",
      "",
      "### What does fleet management track?",
      "",
      "Fleet management usually tracks location, maintenance, fuel, driver activity, compliance records, and cost signals."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.equal(audit.issues.length, 0);
  });

  it("flags repeated topical openers even when exact phrases differ", () => {
    const markdown = [
      "# Freight Broker vs Dispatcher",
      "",
      "## What does a freight broker do?",
      "",
      "Freight brokers arrange transportation between shippers and carriers. Broker teams source carrier capacity for lanes. Brokers coordinate updates when a pickup changes. Carrier access depends on timing."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "repeated-topic-opener" && issue.message.includes("\"broker\"")));
  });

  it("flags repeated opening grammar patterns", () => {
    const markdown = [
      "# Broker Guide",
      "",
      "## What should shippers know?",
      "",
      "Capacity is limited on irregular lanes. Pricing is volatile during seasonal demand. Service is harder to protect without backup options. Route planning depends on available equipment."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "repeated-sentence-pattern" && issue.message.includes("subject-is")));
  });

  it("renders a repair prompt with the audit findings", () => {
    const markdown = "# Article\n\n## Section\n\nThe article starts badly.";
    const audit = auditArticleStyle(markdown);
    const prompt = renderArticleStyleRepairPrompt(markdown, audit);

    assert.match(prompt, /deterministic editorial style audit/);
    assert.match(prompt, /# Article To Repair/);
    assert.match(prompt, /forbidden-sentence-start/);
  });
});
