import type {
  AppSettings,
  CompetitorResearch,
  CreateJobInput,
  ExportArticleResult,
  JobArtifact,
  JobDetail,
  JobSummary,
  SaveIntakeInput,
  StepExecutionResult,
  WorkflowStep
} from "@semantic-seo/shared";

// Runnable Codex steps are now fired-and-polled: the POST returns immediately
// with a 202 ack (or "already-running" when the in-flight lock is held) and the
// real completion is observed via job-detail polling. This ack shape lives on
// the web side only to avoid churning the shared package.
export type StepRunAck = {
  status: "running" | "already-running";
  stepName: WorkflowStep;
};

export type StepCancelAck = {
  cancelled: boolean;
};

type RunnableStep = "semantic-map" | "outline" | "draft" | "final-optimize";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error || "Request failed.");
  }

  return response.json() as Promise<T>;
}

async function requestText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error || "Request failed.");
  }

  return response.text();
}

export const api = {
  getSettings: () => request<AppSettings>("/api/settings"),
  fetchText: (path: string) => requestText(path),
  listJobs: () => request<JobSummary[]>("/api/jobs"),
  createJob: (payload: CreateJobInput) =>
    request<JobSummary>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getJob: (jobId: string) => request<JobDetail>(`/api/jobs/${jobId}`),
  listArtifacts: (jobId: string) => request<JobArtifact[]>(`/api/jobs/${jobId}/artifacts`),
  saveIntake: (jobId: string, payload: SaveIntakeInput) =>
    request<{ ok: boolean }>(`/api/jobs/${jobId}/intake`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  extractCompetitors: (jobId: string) =>
    request<{ ok: boolean; competitorResearch: CompetitorResearch }>(`/api/jobs/${jobId}/extract-competitors`, {
      method: "POST"
    }),
  // Fire the step: expect a 202 ack, not the final result. A 409 (in-flight
  // lock held) is treated gracefully as "already-running" rather than a hard
  // error so a double-trigger just no-ops in the UI.
  runStep: async (jobId: string, stepName: RunnableStep): Promise<StepRunAck> => {
    const response = await fetch(`/api/jobs/${jobId}/steps/${stepName}`, { method: "POST" });

    if (response.status === 409) {
      return { status: "already-running", stepName };
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Request failed." }));
      throw new Error(payload.error || "Request failed.");
    }

    return (await response.json()) as StepRunAck;
  },
  cancelStep: async (jobId: string, stepName: WorkflowStep): Promise<StepCancelAck> => {
    const response = await fetch(`/api/jobs/${jobId}/steps/${stepName}/cancel`, { method: "POST" });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Request failed." }));
      throw new Error(payload.error || "Request failed.");
    }

    return (await response.json()) as StepCancelAck;
  },
  approveOutline: (jobId: string, approvedOutline: string) =>
    request<StepExecutionResult>(`/api/jobs/${jobId}/steps/approve-outline`, {
      method: "POST",
      body: JSON.stringify({ approvedOutline })
    }),
  exportArticle: (jobId: string, format: "markdown" | "html" | "docx") =>
    request<ExportArticleResult>(`/api/jobs/${jobId}/export`, {
      method: "POST",
      body: JSON.stringify({ format })
    })
};
