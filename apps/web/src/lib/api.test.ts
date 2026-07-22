import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

function mockFetchOnce(init: { status: number; body?: unknown }) {
  const response = {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    json: async () => init.body ?? {},
    text: async () => JSON.stringify(init.body ?? {})
  } as unknown as Response;

  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api.runStep fire-and-poll (issue #6)", () => {
  it("returns the 202 ack without treating it as the final result", async () => {
    const spy = mockFetchOnce({ status: 202, body: { status: "running", stepName: "draft" } });

    const ack = await api.runStep("job-1", "draft");

    expect(spy).toHaveBeenCalledWith("/api/jobs/job-1/steps/draft", { method: "POST" });
    expect(ack).toEqual({ status: "running", stepName: "draft" });
  });

  it("treats a 409 in-flight lock as already-running rather than a hard error", async () => {
    mockFetchOnce({ status: 409, body: { error: "Step already running", code: "STEP_ALREADY_RUNNING" } });

    const ack = await api.runStep("job-1", "draft");

    expect(ack).toEqual({ status: "already-running", stepName: "draft" });
  });

  it("throws on other non-ok responses", async () => {
    mockFetchOnce({ status: 400, body: { error: "Save article intake before running this step." } });

    await expect(api.runStep("job-1", "semantic-map")).rejects.toThrow(/Save article intake/);
  });
});

describe("api.cancelStep (issue #6)", () => {
  it("posts to the cancel endpoint and returns the cancel ack", async () => {
    const spy = mockFetchOnce({ status: 200, body: { cancelled: true } });

    const result = await api.cancelStep("job-1", "draft");

    expect(spy).toHaveBeenCalledWith("/api/jobs/job-1/steps/draft/cancel", { method: "POST" });
    expect(result).toEqual({ cancelled: true });
  });
});
