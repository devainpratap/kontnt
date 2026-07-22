import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";

import { AdvancedBriefFields } from "./AdvancedBriefFields";
import { toFormValues, toIntakePayload, type IntakeFormValues } from "../lib/intake";
import type { ArticleIntake } from "@semantic-seo/shared";

function Harness({ onSubmit }: { onSubmit: (intake: ArticleIntake) => void }) {
  const form = useForm<IntakeFormValues>({ defaultValues: toFormValues(null) });
  return (
    <form onSubmit={form.handleSubmit((values) => onSubmit(toIntakePayload(values)))}>
      <input aria-label="Article title / H1" {...form.register("title")} />
      <AdvancedBriefFields register={form.register} />
      <button type="submit">Save intake</button>
    </form>
  );
}

afterEach(cleanup);

describe("AdvancedBriefFields (issue #12)", () => {
  it("is collapsed by default and reveals the advanced fields on expand", async () => {
    render(<Harness onSubmit={() => undefined} />);

    // Collapsed: advanced fields are not in the DOM.
    expect(screen.queryByLabelText(/Intended audience/i)).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /advanced brief/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/Intended audience/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Main entities/i)).toBeInTheDocument();
  });

  it("submits values entered in an advanced field alongside the base fields", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Article title / H1"), "My article");
    await userEvent.click(screen.getByRole("button", { name: /advanced brief/i }));
    await userEvent.type(screen.getByLabelText(/Intended audience/i), "solo founders");

    await userEvent.click(screen.getByRole("button", { name: /save intake/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0] as ArticleIntake;
    expect(payload.title).toBe("My article");
    expect(payload.intendedAudience).toBe("solo founders");
  });
});
