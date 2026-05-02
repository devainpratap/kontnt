import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { JobStatus, StepStatus, WorkflowStep } from "@semantic-seo/shared";

export const jobsTable = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  status: text("status").$type<JobStatus>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  jobPath: text("job_path").notNull()
});

export const jobStepsTable = sqliteTable("job_steps", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  stepName: text("step_name").$type<WorkflowStep>().notNull(),
  status: text("status").$type<StepStatus>().notNull(),
  promptPath: text("prompt_path"),
  outputPath: text("output_path"),
  errorMessage: text("error_message"),
  startedAt: text("started_at"),
  completedAt: text("completed_at")
});

