import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyPage,
  extractDomain,
  extractFeatures,
  extractResults,
  findClientPosition,
  normaliseResultUrl
} from "./parser";

/** A minimal but structurally realistic results page. */
function serpHtml(entries: Array<{ href: string; title: string }>, extra = ""): string {
  const items = entries
    .map((entry) => `<div class="g"><a href="${entry.href}"><h3>${entry.title}</h3></a></div>`)
    .join("");
  return `<html><body><div id="search"><div id="rso">${items}</div></div>${extra}</body></html>`;
}

describe("classifyPage", () => {
  it("recognises a normal results page", () => {
    assert.deepEqual(classifyPage(serpHtml([{ href: "https://a.com", title: "A" }])), { kind: "results" });
  });

  it("detects the unusual-traffic interstitial", () => {
    const page = "<html><body>Our systems have detected unusual traffic from your computer network.</body></html>";
    const result = classifyPage(page);
    assert.equal(result.kind, "blocked");
  });

  it("treats a bare challenge page with no results container as blocked", () => {
    assert.equal(classifyPage('<html><body><div class="g-recaptcha"></div></body></html>').kind, "blocked");
  });

  it("detects the /sorry/ redirect by URL alone", () => {
    assert.equal(classifyPage("<html><body></body></html>", "https://www.google.com/sorry/index?continue=x").kind, "blocked");
  });

  it("does NOT flag a real results page that merely mentions /sorry/index in its markup", () => {
    // Regression. Google embeds a /sorry/index link in the scripts of ordinary
    // results pages, so matching CAPTCHA markers against the body threw away
    // every successful fetch — reporting real rankings as blocks, which is as
    // damaging as the inverse.
    const page = serpHtml(
      [{ href: "https://real.com/a", title: "Real result" }],
      '<script>var cfg={sorryUrl:"/sorry/index?continue=https://www.google.com/search"};</script>'
    );

    assert.deepEqual(classifyPage(page, "https://www.google.com/search?q=test&sei=abc"), { kind: "results" });
    assert.equal(extractResults(page).length, 1);
  });

  it("does NOT flag a results page containing the word recaptcha in a script", () => {
    const page = serpHtml(
      [{ href: "https://real.com/a", title: "Real" }],
      '<script src="https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js"></script>'
    );
    assert.equal(classifyPage(page, "https://www.google.com/search?q=test").kind, "results");
  });

  it("does NOT flag a results page containing cookie-banner wording", () => {
    // "accept all" / "reject all" appear in ordinary page chrome.
    const page = serpHtml([{ href: "https://real.com/a", title: "Real" }], "<div>Accept all cookies</div>");
    assert.equal(classifyPage(page, "https://www.google.com/search?q=test").kind, "results");
  });

  it("still detects an inline interstitial served without a redirect", () => {
    const page =
      '<html><body><div id="search"></div>Our systems have detected unusual traffic from your computer network.</body></html>';
    assert.equal(classifyPage(page, "https://www.google.com/search?q=test").kind, "blocked");
  });

  it("detects a consent interstitial", () => {
    const page = "<html><body><h1>Before you continue to Google</h1></body></html>";
    assert.equal(classifyPage(page).kind, "consent");
  });

  it("treats a page with no results container as blocked, not as empty results", () => {
    // The critical case. An unrecognised page must never be read as "the
    // client ranks nowhere" — that would report a scraper failure as a
    // ranking collapse.
    const result = classifyPage("<html><body><p>Something unexpected</p></body></html>");
    assert.equal(result.kind, "blocked");
  });

  it("checks for a block before a consent screen", () => {
    // A page carrying both signals is blocked; treating it as consent would
    // suggest a retry that will not help.
    const page =
      "<html><body>Our systems have detected unusual traffic. Before you continue to Google, accept cookies.</body></html>";
    assert.equal(classifyPage(page).kind, "blocked");
  });
});

describe("normaliseResultUrl", () => {
  it("keeps a plain https URL", () => {
    assert.equal(normaliseResultUrl("https://example.com/page"), "https://example.com/page");
  });

  it("unwraps a Google /url? redirect", () => {
    assert.equal(
      normaliseResultUrl("/url?q=https://example.com/page&sa=U&ved=abc"),
      "https://example.com/page"
    );
  });

  it("strips tracking parameters so the same page looks the same between checks", () => {
    assert.equal(
      normaliseResultUrl("https://example.com/p?utm_source=google&gclid=xyz&id=7"),
      "https://example.com/p?id=7"
    );
  });

  it("upgrades a protocol-relative URL", () => {
    assert.equal(normaliseResultUrl("//example.com/x"), "https://example.com/x");
  });

  it("rejects internal anchors and javascript hrefs", () => {
    assert.equal(normaliseResultUrl("#top"), null);
    assert.equal(normaliseResultUrl("javascript:void(0)"), null);
    assert.equal(normaliseResultUrl(""), null);
  });
});

describe("extractResults", () => {
  it("returns results in page order with 1-based positions", () => {
    const html = serpHtml([
      { href: "https://first.com/a", title: "First" },
      { href: "https://second.com/b", title: "Second" },
      { href: "https://third.com/c", title: "Third" }
    ]);

    const results = extractResults(html);
    assert.deepEqual(
      results.map((entry) => [entry.position, entry.domain]),
      [
        [1, "first.com"],
        [2, "second.com"],
        [3, "third.com"]
      ]
    );
    assert.equal(results[0].title, "First");
  });

  it("skips Google's own surfaces", () => {
    const html = serpHtml([
      { href: "https://support.google.com/websearch", title: "Help" },
      { href: "https://real.com/page", title: "Real" }
    ]);

    const results = extractResults(html);
    assert.equal(results.length, 1);
    assert.equal(results[0].domain, "real.com");
  });

  it("deduplicates sitelinks that repeat the parent URL", () => {
    const html = serpHtml([
      { href: "https://example.com/", title: "Example" },
      { href: "https://example.com/", title: "Example sitelink" },
      { href: "https://other.com/", title: "Other" }
    ]);

    const results = extractResults(html);
    assert.equal(results.length, 2);
    // Positions must renumber contiguously after the duplicate is dropped.
    assert.deepEqual(results.map((entry) => entry.position), [1, 2]);
  });

  it("strips www when recording the domain", () => {
    const results = extractResults(serpHtml([{ href: "https://www.example.com/x", title: "X" }]));
    assert.equal(results[0].domain, "example.com");
  });

  it("respects the limit", () => {
    const entries = Array.from({ length: 50 }, (_, index) => ({
      href: `https://site${index}.com/`,
      title: `Result ${index}`
    }));
    assert.equal(extractResults(serpHtml(entries), 10).length, 10);
  });

  it("returns nothing for a page with no result anchors", () => {
    assert.deepEqual(extractResults('<html><body><div id="search"></div></body></html>'), []);
  });

  it("ignores anchors without an h3 heading", () => {
    const html = '<html><body><div id="search"><a href="https://nav.com/">Navigation</a></div></body></html>';
    assert.deepEqual(extractResults(html), []);
  });
});

describe("extractFeatures", () => {
  it("detects People Also Ask", () => {
    const html = serpHtml([], "<div>People also ask</div>");
    assert.ok(extractFeatures(html).includes("people-also-ask"));
  });

  it("detects an AI overview", () => {
    const html = serpHtml([], '<div class="ai-overview">summary</div>');
    assert.ok(extractFeatures(html).includes("ai-overview"));
  });

  it("returns nothing for a plain results page", () => {
    assert.deepEqual(extractFeatures(serpHtml([{ href: "https://a.com", title: "A" }])), []);
  });
});

describe("findClientPosition", () => {
  const results = extractResults(
    serpHtml([
      { href: "https://competitor.com/a", title: "Competitor" },
      { href: "https://blog.adclear.in/post", title: "Client blog" },
      { href: "https://another.com/c", title: "Another" }
    ])
  );

  it("finds the client on a subdomain", () => {
    const found = findClientPosition(results, "adclear.in");
    assert.equal(found?.position, 2);
    assert.equal(found?.url, "https://blog.adclear.in/post");
  });

  it("ignores a domain that merely ends with the same letters", () => {
    // notadclear.in must not count as adclear.in.
    const other = extractResults(serpHtml([{ href: "https://notadclear.in/x", title: "Impostor" }]));
    assert.equal(findClientPosition(other, "adclear.in"), null);
  });

  it("returns null when the client is absent", () => {
    assert.equal(findClientPosition(results, "missing.com"), null);
  });

  it("tolerates a www-prefixed client domain", () => {
    const found = findClientPosition(
      extractResults(serpHtml([{ href: "https://www.example.com/", title: "E" }])),
      "www.example.com"
    );
    assert.equal(found?.position, 1);
  });
});

describe("extractDomain", () => {
  it("strips www and lowercases", () => {
    assert.equal(extractDomain("https://WWW.Example.COM/path"), "example.com");
  });

  it("returns empty for an unparseable value", () => {
    assert.equal(extractDomain("not a url"), "");
  });
});
