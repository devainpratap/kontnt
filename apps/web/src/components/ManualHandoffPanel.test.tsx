import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ManualHandoffPanel } from "./ManualHandoffPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ManualHandoffPanel (issue #14)", () => {
  it("explains the manual flow and copies the prompt to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    const handoff = "Run this prompt in Codex or ChatGPT and paste the outline back.";
    render(<ManualHandoffPanel stepLabel="Outline" handoff={handoff} />);

    // Distinct manual-handoff messaging, not "finished content".
    expect(screen.getByText(/Codex was unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/prompt to run, not finished content/i)).toBeInTheDocument();

    const copyButton = screen.getByRole("button", { name: /copy prompt/i });
    await userEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(handoff);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });
});
