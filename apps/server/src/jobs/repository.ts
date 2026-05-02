import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { and, desc, eq } from "drizzle-orm";

import { competitorResearchSchema, stepStatuses, workflowSteps, type ArticleIntake, type JobDetail, type JobStepRecord, type JobSummary, type JobStatus, type WorkflowStep } from "@semantic-seo/shared";

import { appConfig } from "../config";
import { db } from "../db/client";
import { jobStepsTable, jobsTable } from "../db/schema";
import { ApiError } from "../lib/api-error";
import {
  buildJobPaths,
  ensureJobDirs,
  readJsonFile,
  readTextFile,
  type JobPaths
} from "./files";

function slugifyText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "article";
}

function nowIso() {
  return new Date().toISOString();
}

export class JobRepository {
  async createJob(title: string): Promise<JobSummary> {
    const id = randomUUID();
    const slug = slugifyText(title);
    const jobFolderName = `${slug}-${id.slice(0, 8)}`;
    const jobPath = join(appConfig.jobsRoot, jobFolderName);
    const createdAt = nowIso();

    await mkdir(jobPath, { recursive: true });
    await ensureJobDirs(buildJobPaths(jobPath));

    db.insert(jobsTable)
      .values({
        id,
        slug,
        title,
        status: "draft",
        createdAt,
        updatedAt: createdAt,
        jobPath
      })
      .run();

    db.insert(jobStepsTable)
      .values(
        workflowSteps.map((stepName) => ({
          id: randomUUID(),
          jobId: id,
          stepName,
          status: stepStatuses[0],
          promptPath: null,
          outputPath: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null
        }))
      )
      .run();

    return this.getJobOrThrow(id);
  }

  listJobs(): JobSummary[] {
    return db.select().from(jobsTable).orderBy(desc(jobsTable.updatedAt)).all();
  }

  getJob(jobId: string): JobSummary | null {
    return db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).get() ?? null;
  }

  getJobOrThrow(jobId: string): JobSummary {
    const job = this.getJob(jobId);
    if (!job) {
      throw new ApiError(`Job not found: ${jobId}`, 404, "JOB_NOT_FOUND");
    }
    return job;
  }

  getJobSteps(jobId: string): JobStepRecord[] {
    return db.select().from(jobStepsTable).where(eq(jobStepsTable.jobId, jobId)).all();
  }

  async getJobDetail(jobId: string): Promise<JobDetail> {
    const job = this.getJobOrThrow(jobId);
    const paths = buildJobPaths(job.jobPath);
    const [intake, competitorResearchRaw, semanticMap, outline, approvedOutline, draft, finalOptimized] = await Promise.all([
      readJsonFile<ArticleIntake>(paths.intakeFile),
      readJsonFile(paths.competitorResearchFile),
      readTextFile(paths.semanticMapFile),
      readTextFile(paths.outlineFile),
      readTextFile(paths.approvedOutlineFile),
      readTextFile(paths.draftFile),
      readTextFile(paths.finalOptimizedFile)
    ]);
    const parsedCompetitorResearch = competitorResearchSchema.safeParse(competitorResearchRaw);
    const competitorResearch = parsedCompetitorResearch.success ? parsedCompetitorResearch.data : null;

    return {
      job,
      steps: this.getJobSteps(jobId),
      files: {
        intake,
        competitorResearch,
        semanticMap,
        outline,
        approvedOutline,
        draft,
        finalOptimized,
        handoffs: Object.fromEntries(
          (
            await Promise.all(
              workflowSteps.map(async (stepName) => {
                const handoffPath = join(paths.handoffDir, `${stepName}-handoff.md`);
                const content = await readTextFile(handoffPath);
                return content ? [stepName, content] : null;
              })
            )
          ).filter(Boolean) as Array<[string, string]>
        )
      }
    };
  }

  touchJob(jobId: string, status?: JobStatus) {
    const nextStatus = status ?? this.getJobOrThrow(jobId).status;

    db.update(jobsTable)
      .set({
        status: nextStatus,
        updatedAt: nowIso()
      })
      .where(eq(jobsTable.id, jobId))
      .run();
  }

  startStep(jobId: string, stepName: WorkflowStep, promptPath: string, outputPath: string) {
    db.update(jobStepsTable)
      .set({
        status: "running",
        promptPath,
        outputPath,
        errorMessage: null,
        startedAt: nowIso(),
        completedAt: null
      })
      .where(and(eq(jobStepsTable.jobId, jobId), eq(jobStepsTable.stepName, stepName)))
      .run();
  }

  completeStep(jobId: string, stepName: WorkflowStep, status: JobStepRecord["status"], errorMessage: string | null = null) {
    const stepRow = this.getJobSteps(jobId).find((step) => step.stepName === stepName);
    if (!stepRow) {
      return;
    }

    db.update(jobStepsTable)
      .set({
        status,
        errorMessage,
        completedAt: nowIso()
      })
      .where(eq(jobStepsTable.id, stepRow.id))
      .run();
  }

  getJobPaths(jobId: string): JobPaths {
    return buildJobPaths(this.getJobOrThrow(jobId).jobPath);
  }

  getFileLabel(jobId: string) {
    return basename(this.getJobOrThrow(jobId).jobPath);
  }
}
