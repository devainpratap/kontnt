import assert from "node:assert/strict";
import { test } from "node:test";

import { Paragraph, Table, TextRun } from "docx";

import { __test__ } from "./export/article-exporter";

const { markdownToSimpleHtml, markdownToDocxChildren, tokenizeInline, renderInlineHtml } = __test__;

const sampleMarkdown = [
  "# Title",
  "",
  "Intro paragraph with a [link](https://example.com) and **strong** words.",
  "",
  "| Feature | Value |",
  "| --- | :--: |",
  "| **Speed** | Fast |",
  "| Cost | `low` |",
  "",
  "- **Label:** value here",
  "- Plain bullet",
  "",
  "1. First ordered",
  "2. Second ordered"
].join("\n");

test("HTML: renders GFM table structure", () => {
  const html = markdownToSimpleHtml(sampleMarkdown);
  assert.match(html, /<table>/);
  assert.match(html, /<thead>/);
  assert.match(html, /<th[^>]*>Feature<\/th>/);
  assert.match(html, /<tbody>/);
  assert.match(html, /<td[^>]*>Fast<\/td>/);
  // Alignment from `:--:` delimiter applied to the second column.
  assert.match(html, /text-align: center/);
});

test("HTML: renders inline bold, links and code with escaping", () => {
  const html = markdownToSimpleHtml(sampleMarkdown);
  assert.match(html, /<strong>Label:<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
  assert.match(html, /<strong>strong<\/strong>/);
  assert.match(html, /<code>low<\/code>/);
  // Bold inside a table cell.
  assert.match(html, /<strong>Speed<\/strong>/);
});

test("HTML: renders ordered and unordered lists", () => {
  const html = markdownToSimpleHtml(sampleMarkdown);
  assert.match(html, /<ul>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>First ordered<\/li>/);
});

test("HTML: escapes dangerous link URLs", () => {
  const html = renderInlineHtml("[x](javascript:alert(1))");
  assert.doesNotMatch(html, /href="javascript:/);
  // Falls back to plain text when the scheme is rejected.
  assert.match(html, /javascript:alert/);
});

test("HTML: prevents XSS via escaping of text and attributes", () => {
  const html = renderInlineHtml('**<script>alert(1)</script>**');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("DOCX: children include a Table instance", () => {
  const children = markdownToDocxChildren(sampleMarkdown);
  const tables = children.filter((child) => child instanceof Table);
  assert.equal(tables.length, 1);
});

test("DOCX: bullet paragraph contains a bold TextRun", () => {
  const children = markdownToDocxChildren(sampleMarkdown);
  const paragraphs = children.filter((child) => child instanceof Paragraph) as Paragraph[];

  // Collect all TextRun options across paragraphs by inspecting the docx
  // internal representation.
  // docx encodes bold as a `w:b` run property in its OOXML representation.
  const hasBoldRun = paragraphs.some((paragraph) => {
    const json = JSON.stringify(paragraph);
    return /"w:b"/.test(json);
  });
  assert.ok(hasBoldRun, "expected at least one bold TextRun in the document children");
});

test("DOCX: a TextRun is emitted (sanity on run construction)", () => {
  const children = markdownToDocxChildren("Plain paragraph text.");
  const paragraph = children.find((child) => child instanceof Paragraph) as Paragraph;
  assert.ok(paragraph);
  const json = JSON.stringify(paragraph);
  assert.match(json, /Plain paragraph text\./);
});

test("tokenizeInline: parses mixed inline formatting", () => {
  const tokens = tokenizeInline("a **b** c [d](https://x.com) `e`");
  const bold = tokens.find((t) => t.type === "text" && t.bold);
  const link = tokens.find((t) => t.type === "link");
  const code = tokens.find((t) => t.type === "text" && t.code);
  assert.ok(bold && bold.type === "text" && bold.text === "b");
  assert.ok(link && link.type === "link" && link.url === "https://x.com");
  assert.ok(code && code.type === "text" && code.text === "e");
});
