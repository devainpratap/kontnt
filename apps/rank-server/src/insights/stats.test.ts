import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMovements,
  pickCannibalisation,
  pickDecayingPages,
  pickLostQueries,
  pickLosers,
  pickNewQueries,
  pickStrikingDistance,
  pickWinners,
  type PagePeriodRow,
  type QueryPeriodRow
} from "./stats";

function q(query: string, clicks: number, impressions: number, position: number): QueryPeriodRow {
  return { query, clicks, impressions, position };
}

function p(page: string, clicks: number, impressions: number, position: number): PagePeriodRow {
  return { page, clicks, impressions, position };
}

describe("buildMovements", () => {
  it("joins a query present in both periods", () => {
    const movements = buildMovements({
      current: [q("seo agency", 30, 900, 8.2)],
      previous: [q("seo agency", 12, 700, 14.5)]
    });

    assert.equal(movements.length, 1);
    assert.equal(movements[0].clickDelta, 18);
    // Negative position delta means the number fell, which is an improvement.
    assert.ok(movements[0].positionDelta !== null && movements[0].positionDelta < 0);
    assert.equal(Math.round((movements[0].positionDelta as number) * 10) / 10, -6.3);
  });

  it("includes a query that only exists now, with zeros before", () => {
    const movements = buildMovements({ current: [q("brand new", 5, 100, 9)], previous: [] });
    assert.equal(movements[0].previousClicks, 0);
    assert.equal(movements[0].clickDelta, 5);
    // No prior reading means no meaningful position delta.
    assert.equal(movements[0].previousPosition, null);
    assert.equal(movements[0].positionDelta, null);
  });

  it("includes a query that has vanished, rather than silently dropping it", () => {
    // A query that disappeared is one of the most important things in a report.
    const movements = buildMovements({ current: [], previous: [q("gone", 40, 800, 3.1)] });

    assert.equal(movements.length, 1);
    assert.equal(movements[0].query, "gone");
    assert.equal(movements[0].clicks, 0);
    assert.equal(movements[0].clickDelta, -40);
  });

  it("matches queries across case and spacing differences", () => {
    const movements = buildMovements({
      current: [q("SEO  Agency", 10, 100, 5)],
      previous: [q("seo agency", 4, 90, 6)]
    });
    assert.equal(movements.length, 1, "should be one query, not two");
    assert.equal(movements[0].clickDelta, 6);
  });
});

describe("pickWinners / pickLosers", () => {
  const movements = buildMovements({
    current: [q("up big", 50, 900, 4), q("up small", 12, 300, 7), q("down", 3, 200, 22)],
    previous: [q("up big", 10, 800, 9), q("up small", 10, 280, 8), q("down", 30, 600, 6)]
  });

  it("ranks winners by click gain", () => {
    const winners = pickWinners(movements);
    assert.deepEqual(winners.map((w) => w.query), ["up big", "up small"]);
    assert.equal(winners[0].clickDelta, 40);
  });

  it("ranks losers by click loss", () => {
    const losers = pickLosers(movements);
    assert.deepEqual(losers.map((l) => l.query), ["down"]);
    assert.equal(losers[0].clickDelta, -27);
  });

  it("excludes flat queries from both lists", () => {
    const flat = buildMovements({ current: [q("flat", 10, 100, 5)], previous: [q("flat", 10, 100, 5)] });
    assert.deepEqual(pickWinners(flat), []);
    assert.deepEqual(pickLosers(flat), []);
  });

  it("respects the limit", () => {
    const many = buildMovements({
      current: Array.from({ length: 30 }, (_, i) => q(`k${i}`, i + 10, 100, 5)),
      previous: Array.from({ length: 30 }, (_, i) => q(`k${i}`, 1, 100, 5))
    });
    assert.equal(pickWinners(many, 5).length, 5);
  });
});

describe("pickNewQueries", () => {
  it("finds queries with no prior impressions at all", () => {
    const movements = buildMovements({ current: [q("fresh", 8, 200, 6)], previous: [] });
    assert.deepEqual(pickNewQueries(movements).map((m) => m.query), ["fresh"]);
  });

  it("excludes a query that had impressions before and merely started converting", () => {
    // That is a CTR story, not a new-visibility story — different fix, so it
    // must not be filed under "new".
    const movements = buildMovements({
      current: [q("converting", 8, 200, 6)],
      previous: [q("converting", 0, 180, 12)]
    });
    assert.deepEqual(pickNewQueries(movements), []);
  });
});

describe("pickLostQueries", () => {
  it("finds queries that had clicks and now have none", () => {
    const movements = buildMovements({ current: [], previous: [q("lost", 25, 500, 4)] });
    assert.deepEqual(pickLostQueries(movements).map((m) => m.query), ["lost"]);
  });

  it("ignores a query that never had clicks", () => {
    const movements = buildMovements({ current: [], previous: [q("never", 0, 500, 40)] });
    assert.deepEqual(pickLostQueries(movements), []);
  });
});

describe("pickStrikingDistance", () => {
  it("finds high-impression queries just off the click-earning positions", () => {
    const movements = buildMovements({
      current: [q("close", 2, 2000, 12), q("already winning", 200, 2000, 2), q("too deep", 0, 2000, 60)],
      previous: []
    });

    assert.deepEqual(pickStrikingDistance(movements).map((m) => m.query), ["close"]);
  });

  it("excludes low-impression noise", () => {
    const movements = buildMovements({ current: [q("tiny", 0, 5, 12)], previous: [] });
    assert.deepEqual(pickStrikingDistance(movements), []);
  });

  it("ranks by impressions, biggest opportunity first", () => {
    const movements = buildMovements({
      current: [q("small", 0, 200, 12), q("large", 0, 5000, 14), q("medium", 0, 900, 11)],
      previous: []
    });
    assert.deepEqual(pickStrikingDistance(movements).map((m) => m.query), ["large", "medium", "small"]);
  });
});

describe("pickDecayingPages", () => {
  it("labels a page whose impressions held but clicks fell as a CTR problem", () => {
    // Visibility unchanged, clicks down → the listing is losing the click.
    // The fix is a title/meta rewrite, not a ranking campaign.
    const decaying = pickDecayingPages(
      [p("https://a.com/x", 20, 1000, 5)],
      [p("https://a.com/x", 60, 1020, 5)]
    );

    assert.equal(decaying.length, 1);
    assert.equal(decaying[0].cause, "ctr");
    assert.equal(decaying[0].clickDelta, -40);
  });

  it("labels a page that lost visibility as a ranking problem", () => {
    const decaying = pickDecayingPages(
      [p("https://a.com/y", 10, 300, 18)],
      [p("https://a.com/y", 60, 1500, 6)]
    );

    assert.equal(decaying[0].cause, "ranking");
  });

  it("labels a moderate impression drop as mixed", () => {
    const decaying = pickDecayingPages(
      [p("https://a.com/z", 20, 750, 9)],
      [p("https://a.com/z", 40, 1000, 7)]
    );
    assert.equal(decaying[0].cause, "mixed");
  });

  it("ignores pages that grew", () => {
    assert.deepEqual(
      pickDecayingPages([p("https://a.com/up", 80, 1200, 4)], [p("https://a.com/up", 40, 1000, 6)]),
      []
    );
  });

  it("ignores pages with too little prior traffic to be a signal", () => {
    assert.deepEqual(
      pickDecayingPages([p("https://a.com/tiny", 0, 50, 30)], [p("https://a.com/tiny", 2, 60, 28)]),
      []
    );
  });

  it("ignores a page with no prior period at all", () => {
    assert.deepEqual(pickDecayingPages([p("https://a.com/new", 5, 100, 9)], []), []);
  });

  it("orders by severity, worst first", () => {
    const decaying = pickDecayingPages(
      [p("https://a.com/1", 10, 1000, 5), p("https://a.com/2", 5, 1000, 5)],
      [p("https://a.com/1", 30, 1000, 5), p("https://a.com/2", 80, 1000, 5)]
    );
    assert.deepEqual(decaying.map((d) => d.page), ["https://a.com/2", "https://a.com/1"]);
  });
});

describe("pickCannibalisation", () => {
  it("flags a query where two pages compete meaningfully", () => {
    const flagged = pickCannibalisation([
      { query: "seo services", page: "https://a.com/1", clicks: 5, impressions: 600, position: 8 },
      { query: "seo services", page: "https://a.com/2", clicks: 3, impressions: 500, position: 11 }
    ]);

    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].pages.length, 2);
    assert.equal(flagged[0].impressions, 1100);
  });

  it("ignores a page with a trivial share of impressions", () => {
    // The lesson from the keyword suggester: counting every URL that ever
    // appeared flags almost everything.
    const flagged = pickCannibalisation([
      { query: "seo services", page: "https://a.com/1", clicks: 40, impressions: 3168, position: 5 },
      { query: "seo services", page: "https://a.com/2", clicks: 0, impressions: 9, position: 40 }
    ]);

    assert.deepEqual(flagged, []);
  });

  it("ignores low-volume queries entirely", () => {
    const flagged = pickCannibalisation([
      { query: "rare", page: "https://a.com/1", clicks: 0, impressions: 20, position: 8 },
      { query: "rare", page: "https://a.com/2", clicks: 0, impressions: 18, position: 9 }
    ]);
    assert.deepEqual(flagged, []);
  });

  it("orders pages within a query by impressions", () => {
    const flagged = pickCannibalisation([
      { query: "x", page: "https://a.com/small", clicks: 1, impressions: 300, position: 12 },
      { query: "x", page: "https://a.com/big", clicks: 9, impressions: 900, position: 4 }
    ]);
    assert.deepEqual(flagged[0].pages.map((page) => page.page), ["https://a.com/big", "https://a.com/small"]);
  });
});
