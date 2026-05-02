import { z } from "zod";

import { jobStatuses, stepStatuses, workflowSteps } from "./constants";

export const workflowStepSchema = z.enum(workflowSteps);
export const jobStatusSchema = z.enum(jobStatuses);
export const stepStatusSchema = z.enum(stepStatuses);

export const articleIntakeSchema = z.object({
  title: z.string().min(1, "Title is required"),
  targetKeyword: z.string().default(""),
  intendedAudience: z.string().default(""),
  searchIntent: z.string().default(""),
  topRankingUrls: z.array(z.string().url().refine((value) => !/\s/.test(value), "Use one URL per line or separate URLs with spaces.")).default([]),
  competitorNotes: z.string().default(""),
  mainEntities: z.array(z.string()).default([]),
  secondaryEntities: z.array(z.string()).default([]),
  brandContext: z.string().default(""),
  attributes: z.array(z.string()).default([]),
  anchorKeywords: z.array(z.string()).default([]),
  tone: z.string().default("clear, expert, practical"),
  targetWordCount: z.number().int().positive().default(1800),
  internalLinks: z.array(z.string()).default([]),
  preferredCtas: z.array(z.string()).default([])
});

export const createJobSchema = z.object({
  title: z.string().min(1, "Title is required")
});

export const saveIntakeSchema = z.object({
  intake: articleIntakeSchema
});

export const approveOutlineSchema = z.object({
  approvedOutline: z.string().min(1, "Approved outline is required")
});

export const exportFormatSchema = z.enum(["markdown", "html", "docx"]);

export const exportArticleSchema = z.object({
  format: exportFormatSchema.default("markdown")
});

export const extractedCompetitorSchema = z.object({
  url: z.string().url(),
  status: z.enum(["completed", "failed"]),
  title: z.string().default(""),
  metaDescription: z.string().default(""),
  headings: z.array(z.string()).default([]),
  textContent: z.string().default(""),
  excerpt: z.string().default(""),
  errorMessage: z.string().nullable().default(null),
  extractionSource: z.string().default("")
});

export const competitorResearchSchema = z.object({
  generatedAt: z.string(),
  sourceUrls: z.array(z.string().url()).default([]),
  competitors: z.array(extractedCompetitorSchema).default([])
});

export const appSettingsSchema = z.object({
  generationMode: z.enum(["codex", "manual"]),
  codexAvailable: z.boolean(),
  codexAuthenticated: z.boolean(),
  workspaceRoot: z.string(),
  jobsRoot: z.string()
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type StepStatus = z.infer<typeof stepStatusSchema>;
export type ArticleIntake = z.infer<typeof articleIntakeSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type SaveIntakeInput = z.infer<typeof saveIntakeSchema>;
export type ApproveOutlineInput = z.infer<typeof approveOutlineSchema>;
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type ExportArticleInput = z.infer<typeof exportArticleSchema>;
export type ExtractedCompetitor = z.infer<typeof extractedCompetitorSchema>;
export type CompetitorResearch = z.infer<typeof competitorResearchSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
