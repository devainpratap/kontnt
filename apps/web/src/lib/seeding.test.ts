import { describe, expect, it } from "vitest";

import { resolveServerOutline, shouldSeed, type Seed } from "./seeding";

describe("resolveServerOutline", () => {
  it("prefers the approved outline, then the generated outline", () => {
    expect(resolveServerOutline({ approvedOutline: "approved", outline: "generated" })).toBe("approved");
    expect(resolveServerOutline({ approvedOutline: null, outline: "generated" })).toBe("generated");
    expect(resolveServerOutline({ approvedOutline: null, outline: null })).toBe("");
    expect(resolveServerOutline(null)).toBe("");
  });
});

describe("shouldSeed (issue #16 data-loss guard)", () => {
  it("seeds the first time when nothing has been seeded yet", () => {
    expect(shouldSeed(null, "job-1", "")).toBe(true);
  });

  it("seeds when the outline content first arrives from the server", () => {
    const seed: Seed = { jobId: "job-1", signature: "" };
    // Outline was just generated: "" -> real content.
    expect(shouldSeed(seed, "job-1", "# Outline")).toBe(true);
  });

  it("does NOT reseed on a background refetch that returns the same content", () => {
    // The user has edited the textarea; the ref still holds the last server
    // value we seeded from. An unrelated mutation (e.g. Save intake) invalidates
    // the job and produces a NEW data object, but with identical outline content.
    const seed: Seed = { jobId: "job-1", signature: "# Server outline" };
    expect(shouldSeed(seed, "job-1", "# Server outline")).toBe(false);
  });

  it("reseeds when the server outline genuinely changes (e.g. approval)", () => {
    const seed: Seed = { jobId: "job-1", signature: "# Generated outline" };
    expect(shouldSeed(seed, "job-1", "# Approved outline")).toBe(true);
  });

  it("reseeds when navigating to a different job even if content matches", () => {
    const seed: Seed = { jobId: "job-1", signature: "" };
    expect(shouldSeed(seed, "job-2", "")).toBe(true);
  });
});
