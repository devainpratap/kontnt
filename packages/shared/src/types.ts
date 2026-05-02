import type { ArticleIntake, CompetitorResearch, JobStatus, StepStatus, WorkflowStep } from "./schemas";

export type JobSummary = {
  id: string;
  slug: string;
  title: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  jobPath: string;
};

export type JobStepRecord = {
  id: string;
  jobId: string;
  stepName: WorkflowStep;
  status: StepStatus;
  promptPath: string | null;
  outputPath: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type JobFileBundle = {
  intake: ArticleIntake | null;
  competitorResearch: CompetitorResearch | null;
  semanticMap: string | null;
  outline: string | null;
  approvedOutline: string | null;
  draft: string | null;
  finalOptimized: string | null;
  handoffs: Record<string, string>;
};

export type JobDetail = {
  job: JobSummary;
  steps: JobStepRecord[];
  files: JobFileBundle;
};

export type JobArtifact = {
  type: string;
  label: string;
  category: "input" | "output" | "handoff" | "export";
  exists: boolean;
  sizeBytes: number | null;
  path: string;
  url: string;
  downloadUrl: string;
};

export type StepExecutionResult = {
  stepName: WorkflowStep;
  status: StepStatus;
  outputPath: string | null;
  handoffPath: string | null;
  message: string;
};

export type ExportArticleResult = {
  format: "markdown" | "html" | "docx";
  exportPath: string;
  sourcePath: string;
  message: string;
};
