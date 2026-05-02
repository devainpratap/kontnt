import type {
  AppSettings,
  CompetitorResearch,
  CreateJobInput,
  ExportArticleResult,
  JobArtifact,
  JobDetail,
  JobSummary,
  SaveIntakeInput,
  StepExecutionResult
} from "@semantic-seo/shared";

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

export const api = {
  getSettings: () => request<AppSettings>("/api/settings"),
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
  runStep: (jobId: string, stepName: "semantic-map" | "outline" | "draft" | "final-optimize") =>
    request<StepExecutionResult>(`/api/jobs/${jobId}/steps/${stepName}`, {
      method: "POST"
    }),
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
