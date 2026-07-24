import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { markdownToHtml } from "./markdown-html";

describe("markdownToHtml", () => {
  it("renders headings, bold, lists and tables", () => {
    const html = markdownToHtml("## Summary\n\nClicks are **up**.\n\n- one\n- two");
    assert.match(html, /<h2[^>]*>Summary<\/h2>/);
    assert.match(html, /<strong>up<\/strong>/);
    assert.match(html, /<ul[^>]*>.*<li[^>]*>one<\/li>/s);
  });

  it("renders a GFM table", () => {
    const html = markdownToHtml("| Query | Clicks |\n|---|---:|\n| seo | 40 |");
    assert.match(html, /<table/);
    assert.match(html, /<th[^>]*>Query<\/th>/);
    assert.match(html, /<td[^>]*>seo<\/td>/);
  });

  it("escapes HTML so model output cannot inject markup", () => {
    // The one security-relevant property: the brief/report is escaped before
    // any Markdown transform, so a stray tag renders as text, not HTML.
    const html = markdownToHtml("A <script>alert(1)</script> line");
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });

  it("does not treat a literal asterisk pair inside escaped text as a tag", () => {
    const html = markdownToHtml("plain paragraph");
    assert.match(html, /<p[^>]*>plain paragraph<\/p>/);
  });
});
