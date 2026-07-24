import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_OPPORTUNITY_OPTIONS,
  buildSuggestions,
  countCompetingPages,
  estimateCtr,
  isBrandQuery,
  opportunityClicks,
  type CandidateRow
} from "./opportunity";

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    query: "digital marketing agency in noida",
    clicks: 5,
    impressions: 1000,
    position: 12,
    pageCount: 1,
    topPage: "https://adclear.in/",
    ...overrides
  };
}

describe("estimateCtr", () => {
  it("decreases monotonically through page one", () => {
    for (let position = 1; position < 10; position += 1) {
      assert.ok(
        estimateCtr(position) > estimateCtr(position + 1),
        `position ${position} should out-earn ${position + 1}`
      );
    }
  });

  it("drops sharply past page one", () => {
    assert.ok(estimateCtr(11) < estimateCtr(10));
    assert.ok(estimateCtr(21) < estimateCtr(11));
  });

  it("clamps positions below 1", () => {
    assert.equal(estimateCtr(0.4), estimateCtr(1));
  });
});

describe("opportunityClicks", () => {
  it("is zero for a query already at or above the target position", () => {
    assert.equal(opportunityClicks(1000, 3, 110), 0);
    assert.equal(opportunityClicks(1000, 1, 270), 0);
  });

  it("never returns a negative value", () => {
    // A query already out-earning the curve is not an opportunity, and a
    // negative score would sort it above genuine ones.
    assert.equal(opportunityClicks(100, 5, 500), 0);
  });

  it("scales with impressions", () => {
    assert.ok(opportunityClicks(2000, 15, 2) > opportunityClicks(200, 15, 2));
  });
});

describe("isBrandQuery", () => {
  it("matches a brand term as a whole word", () => {
    assert.equal(isBrandQuery("adclear digital marketing", ["adclear"]), true);
    assert.equal(isBrandQuery("AdClear", ["adclear"]), true);
    assert.equal(isBrandQuery("reviews of adclear", ["adclear"]), true);
  });

  it("does not match a brand term appearing inside another word", () => {
    // Substring matching would wrongly hide "smiracle cream" for brand "smira".
    assert.equal(isBrandQuery("smiracle cream", ["smira"]), false);
    assert.equal(isBrandQuery("adclearance sale", ["adclear"]), false);
  });

  it("is false when no brand terms are configured", () => {
    assert.equal(isBrandQuery("anything at all", []), false);
  });

  it("ignores blank brand terms", () => {
    assert.equal(isBrandQuery("anything", ["", "   "]), false);
  });

  it("treats regex characters in a brand term literally", () => {
    assert.equal(isBrandQuery("a.b marketing", ["a.b"]), true);
    assert.equal(isBrandQuery("axb marketing", ["a.b"]), false);
  });
});

describe("buildSuggestions", () => {
  it("surfaces a striking-distance query", () => {
    const { suggestions } = buildSuggestions([candidate({ position: 12 })]);
    assert.equal(suggestions.length, 1);
    assert.ok(suggestions[0].reasons.includes("striking-distance"));
  });

  it("excludes queries below the impression floor", () => {
    const { suggestions } = buildSuggestions([candidate({ impressions: 5 })]);
    assert.equal(suggestions.length, 0);
  });

  it("excludes a top-3 query that is already performing normally", () => {
    // Position 2 earning roughly the expected CTR has nothing to chase.
    const { suggestions } = buildSuggestions([candidate({ position: 2, impressions: 1000, clicks: 150 })]);
    assert.equal(suggestions.length, 0);
  });

  it("still surfaces a top-3 query that is bleeding clicks", () => {
    // Ranking second with 1,000 impressions but only 5 clicks is a listing
    // problem, not a ranking one — different fix, but worth knowing about, so
    // it is surfaced as a CTR issue rather than as striking distance.
    const { suggestions } = buildSuggestions([candidate({ position: 2, impressions: 1000, clicks: 5 })]);
    assert.equal(suggestions.length, 1);
    assert.deepEqual(suggestions[0].reasons, ["high-impression-low-ctr"]);
  });

  it("excludes queries buried too deep to be realistic", () => {
    const { suggestions } = buildSuggestions([candidate({ position: 78 })]);
    assert.equal(suggestions.length, 0);
  });

  it("excludes branded queries and counts them", () => {
    const { suggestions, totals } = buildSuggestions(
      [candidate({ query: "adclear pricing" }), candidate({ query: "seo agency noida" })],
      { ...DEFAULT_OPPORTUNITY_OPTIONS, brandTerms: ["adclear"] }
    );

    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].query, "seo agency noida");
    assert.equal(totals.brandExcluded, 1);
  });

  it("never suggests a keyword that is already tracked", () => {
    const { suggestions, totals } = buildSuggestions(
      [candidate({ query: "seo agency noida" })],
      // Different case and spacing — normalisation must still match.
      { ...DEFAULT_OPPORTUNITY_OPTIONS, trackedPhrases: ["SEO  Agency   Noida"] }
    );

    assert.equal(suggestions.length, 0);
    assert.equal(totals.alreadyTracked, 1);
  });

  it("flags cannibalization when two pages rank for one query", () => {
    const { suggestions } = buildSuggestions([candidate({ pageCount: 3 })]);
    assert.ok(suggestions[0].reasons.includes("cannibalization"));
  });

  it("flags a page-one query that under-earns its position", () => {
    // Position 5 with 4,000 impressions should earn ~240 clicks; 3 means the
    // problem is the listing, not the ranking.
    const { suggestions } = buildSuggestions([
      candidate({ position: 5, impressions: 4000, clicks: 3 })
    ]);
    assert.ok(suggestions[0].reasons.includes("high-impression-low-ctr"));
  });

  it("does not flag low CTR for a query performing in line with its position", () => {
    const { suggestions } = buildSuggestions([
      candidate({ position: 5, impressions: 4000, clicks: 240 })
    ]);
    assert.equal(suggestions[0].reasons.includes("high-impression-low-ctr"), false);
  });

  it("ranks by modelled opportunity, biggest first", () => {
    const { suggestions } = buildSuggestions([
      candidate({ query: "small", impressions: 200, position: 15, clicks: 1 }),
      candidate({ query: "large", impressions: 5000, position: 15, clicks: 4 }),
      candidate({ query: "medium", impressions: 1200, position: 15, clicks: 2 })
    ]);

    assert.deepEqual(
      suggestions.map((entry) => entry.query),
      ["large", "medium", "small"]
    );
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      candidate({ query: `keyword ${index}`, impressions: 100 + index })
    );
    const { suggestions } = buildSuggestions(many, { ...DEFAULT_OPPORTUNITY_OPTIONS, limit: 10 });
    assert.equal(suggestions.length, 10);
  });

  it("reports why a shortlist is short", () => {
    // An empty list with no explanation reads as "nothing to do"; the counts
    // let the UI say what was filtered instead.
    const { totals } = buildSuggestions(
      [
        candidate({ query: "adclear" }),
        candidate({ query: "tracked one" }),
        candidate({ query: "too small", impressions: 2 })
      ],
      { ...DEFAULT_OPPORTUNITY_OPTIONS, brandTerms: ["adclear"], trackedPhrases: ["tracked one"] }
    );

    assert.equal(totals.candidates, 3);
    assert.equal(totals.alreadyTracked, 1);
    assert.equal(totals.brandExcluded, 1);
  });

  it("returns an empty shortlist for no candidates", () => {
    const { suggestions, totals } = buildSuggestions([]);
    assert.deepEqual(suggestions, []);
    assert.equal(totals.candidates, 0);
  });
});

describe("countCompetingPages", () => {
  it("counts a single page", () => {
    assert.equal(countCompetingPages([500]), 1);
  });

  it("ignores a page with a trivial share of impressions", () => {
    // Real data: one page on 3,168 impressions, two others on 9 and 5. That is
    // a URL that briefly surfaced, not two pages competing.
    assert.equal(countCompetingPages([3168, 9, 5]), 1);
  });

  it("counts two pages that genuinely compete", () => {
    assert.equal(countCompetingPages([1000, 600]), 2);
  });

  it("applies an absolute floor so tiny queries do not trip the ratio", () => {
    // 8 is 40% of 20, but both are too small to call cannibalization.
    assert.equal(countCompetingPages([20, 8]), 1);
  });

  it("counts three-way competition", () => {
    assert.equal(countCompetingPages([1000, 800, 500]), 3);
  });

  it("returns zero for no pages", () => {
    assert.equal(countCompetingPages([]), 0);
  });
});
