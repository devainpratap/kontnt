import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseKeywordImport } from "./parse-import";

describe("parseKeywordImport", () => {
  it("reads one keyword per line", () => {
    const result = parseKeywordImport("gps tracker\nvehicle tracker\nfleet management");
    assert.deepEqual(
      result.rows.map((row) => row.phrase),
      ["gps tracker", "vehicle tracker", "fleet management"]
    );
    assert.deepEqual(result.invalid, []);
  });

  it("reads keyword and target URL pairs", () => {
    const result = parseKeywordImport("gps tracker, https://example.com/gps");
    assert.equal(result.rows[0].phrase, "gps tracker");
    assert.equal(result.rows[0].targetUrl, "https://example.com/gps");
  });

  it("accepts tab-separated input", () => {
    const result = parseKeywordImport("gps tracker\thttps://example.com/gps");
    assert.equal(result.rows[0].phrase, "gps tracker");
    assert.equal(result.rows[0].targetUrl, "https://example.com/gps");
  });

  it("skips a header row", () => {
    const result = parseKeywordImport("Keyword,Target URL\ngps tracker,https://example.com/gps");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].phrase, "gps tracker");
  });

  it("handles quoted fields containing commas", () => {
    const result = parseKeywordImport('"tracker, gps and fleet",https://example.com/x');
    assert.equal(result.rows[0].phrase, "tracker, gps and fleet");
    assert.equal(result.rows[0].targetUrl, "https://example.com/x");
  });

  it("handles escaped quotes inside a quoted field", () => {
    const result = parseKeywordImport('"say ""hello"" tracker"');
    assert.equal(result.rows[0].phrase, 'say "hello" tracker');
  });

  it("normalises case and collapses internal whitespace", () => {
    // "gps   tracker" and "GPS tracker" must be one keyword, not two rows that
    // get scraped twice and reported separately.
    const result = parseKeywordImport("GPS   Tracker\n  gps tracker  ");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].phrase, "gps tracker");
  });

  it("collapses duplicates within one paste, keeping the first", () => {
    const result = parseKeywordImport(
      "gps tracker,https://example.com/first\ngps tracker,https://example.com/second"
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].targetUrl, "https://example.com/first");
  });

  it("ignores blank lines", () => {
    const result = parseKeywordImport("gps tracker\n\n\n   \nvehicle tracker");
    assert.equal(result.rows.length, 2);
  });

  it("rejects a URL pasted into the keyword column", () => {
    // Almost always a column mix-up; tracking it would burn checks on a query
    // nobody searches.
    const result = parseKeywordImport("https://example.com/gps");
    assert.equal(result.rows.length, 0);
    assert.match(result.invalid[0].reason, /URL, not a search term/i);
  });

  it("keeps the keyword but reports an unusable target URL", () => {
    const result = parseKeywordImport("gps tracker, not-a-url");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].targetUrl, null);
    assert.match(result.invalid[0].reason, /not a valid http/i);
  });

  it("rejects an over-long phrase with a stated reason", () => {
    const result = parseKeywordImport("x".repeat(250));
    assert.equal(result.rows.length, 0);
    assert.match(result.invalid[0].reason, /200 characters/);
  });

  it("rejects a row whose first column is empty", () => {
    const result = parseKeywordImport(", https://example.com/gps");
    assert.equal(result.rows.length, 0);
    assert.match(result.invalid[0].reason, /No keyword/i);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(parseKeywordImport(""), { rows: [], invalid: [] });
    assert.deepEqual(parseKeywordImport("   \n  \n"), { rows: [], invalid: [] });
  });

  it("handles a realistic mixed paste", () => {
    const result = parseKeywordImport(
      [
        "Keyword,Target",
        "digital marketing agency in noida,https://adclear.in/",
        "seo agency in noida",
        "",
        "SEO Agency In Noida",
        "https://oops.com/pasted-wrong",
        '"agency, digital, noida",https://adclear.in/services'
      ].join("\n")
    );

    assert.deepEqual(
      result.rows.map((row) => row.phrase),
      ["digital marketing agency in noida", "seo agency in noida", "agency, digital, noida"]
    );
    assert.equal(result.rows[0].targetUrl, "https://adclear.in/");
    assert.equal(result.invalid.length, 1);
  });
});
