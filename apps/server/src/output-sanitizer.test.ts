import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeGeneratedMarkdown } from "./generation/output-sanitizer";

describe("generated output sanitizer", () => {
  it("replaces long dash characters and trims trailing whitespace", () => {
    const input = `A${"\u2014"}B\nC ${"\u2013"} D  \n`;

    assert.equal(sanitizeGeneratedMarkdown(input), "A - B\nC - D");
  });
});
