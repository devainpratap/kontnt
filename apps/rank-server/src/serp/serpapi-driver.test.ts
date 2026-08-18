import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSerpApiParams, googleDomainForCountry, mapSerpApiFeatures, mapSerpApiResults } from "./serpapi-driver";
import { extractHtmlPayload } from "./scrapingrobot-driver";

describe("mapSerpApiResults", () => {
  it("maps organic results in order", () => {
    const results = mapSerpApiResults({
      organic_results: [
        { position: 1, link: "https://first.com/a", title: "First" },
        { position: 2, link: "https://second.com/b", title: "Second" }
      ]
    });

    assert.deepEqual(
      results.map((entry) => [entry.position, entry.domain, entry.title]),
      [
        [1, "first.com", "First"],
        [2, "second.com", "Second"]
      ]
    );
  });

  it("renumbers contiguously rather than trusting the provider's position", () => {
    // SerpApi's `position` can skip values where Google interleaves non-organic
    // blocks. A tracked rank must always mean "nth organic result", the same
    // definition every other driver uses, or history breaks across a provider
    // switch.
    const results = mapSerpApiResults({
      organic_results: [
        { position: 1, link: "https://a.com/", title: "A" },
        { position: 4, link: "https://b.com/", title: "B" },
        { position: 9, link: "https://c.com/", title: "C" }
      ]
    });

    assert.deepEqual(results.map((entry) => entry.position), [1, 2, 3]);
  });

  it("deduplicates repeated URLs, keeping the highest", () => {
    const results = mapSerpApiResults({
      organic_results: [
        { position: 1, link: "https://a.com/", title: "A" },
        { position: 2, link: "https://a.com/", title: "A sitelink" },
        { position: 3, link: "https://b.com/", title: "B" }
      ]
    });

    assert.equal(results.length, 2);
    assert.deepEqual(results.map((entry) => entry.domain), ["a.com", "b.com"]);
  });

  it("strips www from the recorded domain", () => {
    const results = mapSerpApiResults({ organic_results: [{ link: "https://www.example.com/x" }] });
    assert.equal(results[0].domain, "example.com");
  });

  it("skips entries with no usable link", () => {
    const results = mapSerpApiResults({
      organic_results: [{ title: "No link" }, { link: "not-a-url" }, { link: "https://ok.com/" }]
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].domain, "ok.com");
  });

  it("returns nothing for an empty or absent array", () => {
    assert.deepEqual(mapSerpApiResults({}), []);
    assert.deepEqual(mapSerpApiResults({ organic_results: [] }), []);
  });
});

describe("mapSerpApiFeatures", () => {
  it("detects the features SerpApi reports", () => {
    const features = mapSerpApiFeatures({
      related_questions: [{}],
      answer_box: {},
      ai_overview: {}
    });

    assert.ok(features.includes("people-also-ask"));
    assert.ok(features.includes("featured-snippet"));
    assert.ok(features.includes("ai-overview"));
  });

  it("returns nothing for a plain SERP", () => {
    assert.deepEqual(mapSerpApiFeatures({ organic_results: [] }), []);
  });
});

describe("googleDomainForCountry", () => {
  it("maps a country to its Google ccTLD so the SERP is localized", () => {
    assert.equal(googleDomainForCountry("in"), "google.co.in");
    assert.equal(googleDomainForCountry("us"), "google.com");
    assert.equal(googleDomainForCountry("gb"), "google.co.uk");
    assert.equal(googleDomainForCountry("uk"), "google.co.uk");
  });

  it("is case-insensitive", () => {
    assert.equal(googleDomainForCountry("IN"), "google.co.in");
  });

  it("falls back to google.com for an unknown country", () => {
    assert.equal(googleDomainForCountry("zz"), "google.com");
  });
});

describe("buildSerpApiParams", () => {
  const base = { keyword: "digital marketing noida", country: "in", device: "desktop" as const, location: null };

  it("localizes to the country (google_domain + gl) and forces a fresh, uncached fetch", () => {
    const p = buildSerpApiParams(base, 0, "KEY");
    assert.equal(p.get("engine"), "google");
    assert.equal(p.get("q"), "digital marketing noida");
    assert.equal(p.get("google_domain"), "google.co.in");
    assert.equal(p.get("gl"), "in");
    assert.equal(p.get("hl"), "en");
    assert.equal(p.get("device"), "desktop");
    assert.equal(p.get("no_cache"), "true");
    assert.equal(p.get("start"), "0");
    assert.equal(p.get("api_key"), "KEY");
  });

  it("omits location when unset and includes it when present", () => {
    assert.equal(buildSerpApiParams(base, 0, "KEY").has("location"), false);
    const withLoc = buildSerpApiParams({ ...base, location: "Noida,Uttar Pradesh,India" }, 0, "KEY");
    assert.equal(withLoc.get("location"), "Noida,Uttar Pradesh,India");
  });

  it("paginates via start in tens", () => {
    assert.equal(buildSerpApiParams(base, 2, "KEY").get("start"), "20");
  });
});

describe("extractHtmlPayload (ScrapingRobot envelope)", () => {
  // Their API reference is not public, so the driver accepts the plausible
  // envelope shapes rather than assuming one and failing opaquely.
  it("reads a plain string result", () => {
    assert.equal(extractHtmlPayload({ result: "<html>ok</html>" }), "<html>ok</html>");
  });

  it("reads a nested html field", () => {
    assert.equal(extractHtmlPayload({ result: { html: "<html>a</html>" } }), "<html>a</html>");
  });

  it("reads a nested content field", () => {
    assert.equal(extractHtmlPayload({ result: { content: "<html>b</html>" } }), "<html>b</html>");
  });

  it("reads a top-level data string", () => {
    assert.equal(extractHtmlPayload({ data: "<html>c</html>" }), "<html>c</html>");
  });

  it("returns null when no HTML is present, rather than an empty string", () => {
    // null keeps "no HTML found" distinguishable from "the page was empty".
    assert.equal(extractHtmlPayload({}), null);
    assert.equal(extractHtmlPayload({ result: "" }), null);
    assert.equal(extractHtmlPayload({ result: {} }), null);
    assert.equal(extractHtmlPayload({ error: "bad token" }), null);
  });
});
