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

  it("requires two to three sentences below each non-FAQ H3", () => {
    const markdown = [
      "---",
      "title: Fleet Guide",
      "---",
      "",
      "## Components",
      "",
      "### Telematics",
      "",
      "Telematics captures vehicle diagnostics and location data. Maintenance teams use those signals for service planning. Dispatchers use mileage data to schedule service. Finance teams compare repairs against downtime cost."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.deepEqual(
      audit.issues.filter((issue) => issue.code === "h3-sentence-count").map((issue) => issue.section),
      ["Telematics"]
    );
  });

  it("does not flag a varied section with two-sentence H3s", () => {
    const markdown = [
      "---",
      "title: Fleet Guide",
      "---",
      "",
      "## Components",
      "",
      "Connected fleet systems link field activity to operational decisions.",
      "",
      "### Telematics",
      "",
      "Vehicle diagnostics, mileage, and location data come from telematics signals.",
      "",
      "Maintenance planning becomes more reliable when those signals trigger service alerts before failures interrupt scheduled work.",
      "",
      "### Fuel management",
      "",
      "Fuel purchases, idling, route choices, and vehicle assignments connect through cost monitoring.",
      "",
      "Cost reviews become more precise when finance can compare fuel transactions with actual vehicle movement."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.equal(audit.issues.length, 0);
  });

  it("allows concise FAQ H3 answers", () => {
    const markdown = [
      "---",
      "title: Fleet Guide",
      "---",
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

  it("flags editorial leaks, bridge sentences, long sentences, bad bullets, and table process columns", () => {
    const markdown = [
      "# Fleet Guide",
      "",
      "## What Are Fleet Management Risks?",
      "",
      "Now that the basics are clear, risk analysis should begin with maintenance, fuel, driver behavior, route planning, compliance records, and cost controls that stretch beyond a single operational dashboard for growing teams.",
      "",
      "Claims should be verified before publication.",
      "",
      "- Missing bold label: This bullet does not follow the required format.",
      "",
      "| Feature | Drafting Caution |",
      "| --- | --- |",
      "| Tracking | Writer note |"
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "bridge-sentence"));
    assert.ok(audit.issues.some((issue) => issue.code === "banned-phrase"));
    assert.ok(audit.issues.some((issue) => issue.code === "long-sentence"));
    assert.ok(audit.issues.some((issue) => issue.code === "bullet-format"));
    assert.ok(audit.issues.some((issue) => issue.code === "table-editorial-column"));
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

  it("flags content before the first H2", () => {
    const markdown = [
      "---",
      "title: Fleet Guide",
      "---",
      "",
      "## Key Takeaways",
      "",
      "- Fast summary.",
      "",
      "## What Is Fleet Management?",
      "",
      "Fleet management connects vehicles, drivers, maintenance, fuel, and compliance records."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.equal(audit.issues.some((issue) => issue.code === "pre-h2-content"), false);

    const markdownWithPreH2 = [
      "---",
      "title: Fleet Guide",
      "---",
      "",
      "Quick summary before the article.",
      "",
      "## What Is Fleet Management?",
      "",
      "Fleet management connects vehicles, drivers, maintenance, fuel, and compliance records."
    ].join("\n");

    const preH2Audit = auditArticleStyle(markdownWithPreH2);

    assert.ok(preH2Audit.issues.some((issue) => issue.code === "pre-h2-content"));
  });

  it("flags Matrack pitch structure and missing pricing or flexibility", () => {
    const markdown = [
      "---",
      "title: Fleet Guide",
      "---",
      "",
      "## What Is Fleet Management?",
      "",
      "Fleet management connects vehicles, drivers, maintenance, fuel, and compliance records.",
      "",
      "## What Is the Best Fleet Management Solution?",
      "",
      "Matrack is the best fleet management solution for businesses that need GPS tracking and maintenance alerts.",
      "",
      "### Real-Time GPS Fleet Tracking",
      "",
      "GPS tracking shows where vehicles are during active work.",
      "",
      "- **Dashboard:** Teams can review status in one place.",
      "",
      "## Final Thoughts",
      "",
      "Fleet management works best when operational data supports daily decisions."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "pitch-structure"));
    assert.ok(audit.issues.some((issue) => issue.code === "pitch-pricing-flexibility"));
  });

  it("accepts a three-paragraph Matrack pitch with pricing and flexibility context", () => {
    const markdown = [
      "---",
      "title: Fleet Guide",
      "---",
      "",
      "## What Is Fleet Management?",
      "",
      "Fleet management connects vehicles, drivers, maintenance, fuel, and compliance records.",
      "",
      "## What Is the Best Fleet Management Solution?",
      "",
      "Matrack is the best fleet management solution for businesses that need real-time GPS fleet tracking, maintenance alerts, driver behavior monitoring / coaching, and a centralized dashboard in one connected platform. Operational teams can turn location, service, driver, and cost signals into faster dispatch and maintenance decisions.",
      "",
      "Affordable monthly plans, easy-install hardware, and no long-term contracts make the platform suitable for small fleets to large enterprises. Teams can monitor vehicle movement, service needs, driver activity, and reporting workflows without adding separate tools for each task.",
      "",
      "Best-fit value comes from combining GPS tracking, maintenance alerts, and driver coaching in one platform. Instead of using separate tools for routing, service planning, and behavior review, businesses can manage these needs through one practical fleet management solution.",
      "",
      "## Final Thoughts",
      "",
      "Fleet management works best when operational data supports daily decisions."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.equal(audit.issues.some((issue) => issue.code === "pitch-structure"), false);
    assert.equal(audit.issues.some((issue) => issue.code === "pitch-pricing-flexibility"), false);
  });

  it("flags repeated caveats", () => {
    const markdown = [
      "---",
      "title: Vehicle Weight Guide",
      "---",
      "",
      "## What Is Curb Weight?",
      "",
      "Curb weight includes fluids based on the manufacturer's definition. Operating fluid coverage is listed based on the manufacturer's definition. Documentation varies based on the manufacturer's definition."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "repeated-caveat"));
  });

  it("flags H3 heading echoes", () => {
    const markdown = [
      "---",
      "title: Camera Guide",
      "---",
      "",
      "## What Features Matter?",
      "",
      "Camera feature reviews should focus on evidence quality and retrieval.",
      "",
      "### Video Capture",
      "",
      "Video capture records road, cab, and cargo context for incident review. Claim teams can compare footage with timestamps and GPS records.",
      "",
      "### Upfront Hardware",
      "",
      "Upfront hardware covers cameras, mounts, cables, and installation materials. Budget planning becomes easier when device costs are separated from monthly service."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "h3-heading-echo" && issue.section === "Video Capture"));
  });

  it("flags repeated H2 opening patterns across sections", () => {
    const markdown = [
      "---",
      "title: Owner Operator Camera Guide",
      "---",
      "",
      "## How Should Owner Operators Compare Features?",
      "",
      "Owner operators should compare camera features against evidence needs and total operating cost.",
      "",
      "## How Should Owner Operators Budget For Cameras?",
      "",
      "Owner operators should budget for hardware, installation, monthly service, and replacement risk.",
      "",
      "## How Should Owner Operators Choose A Vendor?",
      "",
      "Owner operators should choose vendors based on footage access, support response, and contract flexibility."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "h2-opening-pattern"));
  });

  it("flags repeated bullet internal structure", () => {
    const markdown = [
      "---",
      "title: Camera Guide",
      "---",
      "",
      "## What Features Matter?",
      "",
      "Camera feature reviews should separate evidence needs from sales claims.",
      "",
      "- **Camera Views:** Road-facing, driver-facing, side, rear, and cargo-adjacent views solve different evidence problems.",
      "- **Video Quality:** Resolution, low-light visibility, field of view, and frame reliability determine whether footage can clarify an event.",
      "- **AI Alerts:** Distraction, tailgating, drowsiness, harsh braking, and lane-departure alerts reduce manual review by tagging risk events.",
      "- **GPS Context:** Location, speed, route, and timestamp overlays strengthen incident timelines."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "bullet-internal-pattern"));
  });

  it("flags section closings that mirror section openings", () => {
    const markdown = [
      "---",
      "title: Camera Guide",
      "---",
      "",
      "## How Should Owner Operators Compare Features?",
      "",
      "Owner operators should compare fleet dash camera features by checking evidence capture, retrieval speed, driver acceptance, and total cost control.",
      "",
      "Trial periods can reveal whether alerts, support workflows, and footage access match daily operations.",
      "",
      "Practical comparison comes from matching evidence capture, retrieval speed, driver acceptance, and total cost control to actual exposure."
    ].join("\n");

    const audit = auditArticleStyle(markdown);

    assert.ok(audit.issues.some((issue) => issue.code === "section-opening-closing-mirror"));
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
