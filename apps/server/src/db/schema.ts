import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const jobStepsTable = sqliteTable(
  "job_steps",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    stepName: text("step_name").$type<WorkflowStep>().notNull(),
    status: text("status").$type<StepStatus>().notNull(),
    promptPath: text("prompt_path"),
    outputPath: text("output_path"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at")
  },
  (table) => ({
    // Speeds up the very common getJobSteps(jobId) lookups.
    jobIdIdx: index("job_steps_job_id_idx").on(table.jobId),
    // createJob inserts exactly one row per (job, step); startStep/completeStep
    // assume that uniqueness. Enforcing it also guards against duplicate rows.
    jobIdStepNameUnique: uniqueIndex("job_steps_job_id_step_name_unique").on(
      table.jobId,
      table.stepName
    )
  })
);

