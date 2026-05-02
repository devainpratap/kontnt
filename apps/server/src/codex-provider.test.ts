import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTransientCodexFailure } from "./generation/codex-provider";

describe("Codex provider failure classification", () => {
  it("detects transient transport failures", () => {
    assert.equal(
      isTransientCodexFailure({
        exitCode: 1,
        stdout: "",
        stderr: "stream disconnected before completion: Transport channel closed"
      }),
      true
    );
  });

  it("does not classify usage limits as transient transport failures", () => {
    assert.equal(
      isTransientCodexFailure({
        exitCode: 1,
        stdout: "",
        stderr: "You've hit your usage limit"
      }),
      false
    );
  });
});
