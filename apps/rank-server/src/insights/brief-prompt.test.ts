import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ClientRecord } from "@rankos/shared";

import { buildBriefPrompt } from "./prompt-builder";
import { buildInsightStats } from "./stats";

const client: ClientRecord = {
  id: "c1", name: "AdClear", slug: "adclear", primaryDomain: "adclear.in",
  gscProperty: "https://adclear.in/", gscPropertyType: "url-prefix",
  brandTerms: ["adclear"], notes: "", clientPath: "/tmp/x",
  createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z", archivedAt: null
};

function stats() {
  return buildInsightStats({
    window: { startDate: "2026-06-25", endDate: "2026-07-22", days: 28 },
    previousWindow: { startDate: "2026-05-28", endDate: "2026-06-24" },
    currentQueries: [{ query: "seo for universities", clicks: 4, impressions: 900, position: 12 }],
    previousQueries: [{ query: "seo for universities", clicks: 0, impressions: 700, position: 18 }],
    currentPages: [], previousPages: [], queryPageRows: [],
    totals: { clicks: 69, impressions: 16837, ctr: 0.004, position: 30 },
    previousTotals: { clicks: 110, impressions: 17942, ctr: 0.006, position: 32 },
    coverage: { totalClicks: 69, attributedClicks: 40, coverageRatio: 0.58 }
  });
}

describe("buildBriefPrompt", () => {
  it("carries the same computed numbers as the detailed report", () => {
    // The two forms share one stats object, so they can never disagree.
    const prompt = buildBriefPrompt(client, stats());
    assert.match(prompt, /69/);      // current clicks
    assert.match(prompt, /16,837/);  // impressions, formatted
    assert.match(prompt, /AdClear/);
  });

  it("instructs WhatsApp formatting, not document formatting", () => {
    const prompt = buildBriefPrompt(client, stats());
    assert.match(prompt, /WhatsApp/i);
    assert.match(prompt, /single asterisk/i);
    assert.match(prompt, /no tables/i);
    assert.match(prompt, /120 to 180 words/i);
  });

  it("tells the model to lead with wins and forbids inventing numbers", () => {
    const prompt = buildBriefPrompt(client, stats());
    assert.match(prompt, /lead with the wins/i);
    assert.match(prompt, /only the numbers/i);
  });

  it("mentions brand exclusion when brand terms exist", () => {
    assert.match(buildBriefPrompt(client, stats()), /branded/i);
  });
});
