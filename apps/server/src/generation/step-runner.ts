import type { ArticleIntake, CompetitorResearch, JobStatus, StepExecutionResult, WorkflowStep } from "@semantic-seo/shared";

import { readTextFile, writeMarkdownFile } from "../jobs/files";
import { JobRepository } from "../jobs/repository";
import { ApiError } from "../lib/api-error";
import { getCodexStatus, isTransientCodexFailure, runCodexStep } from "./codex-provider";
import { renderManualHandoff } from "./manual-handoff";
import { sanitizeGeneratedMarkdown } from "./output-sanitizer";
import { buildSemanticPromptContext, renderStepPrompt } from "./prompt-loader";

const nextJobStatusByStep: Record<WorkflowStep, JobStatus> = {
  "semantic-map": "semantic-map-ready",
  outline: "outline-ready",
  "approve-outline": "outline-approved",
  draft: "draft-ready",
  "final-optimize": "final-ready"
};

function summarizeCodexFailure(stdout: string, stderr: string) {
  const combined = `${stderr}\n${stdout}`.trim();

  if (combined.includes("You've hit your usage limit")) {
    const match = combined.match(/You've hit your usage limit[^\n]*/);
    return match?.[0] ?? "Codex usage limit reached.";
  }

  return combined.slice(0, 1200) || "Codex execution failed.";
}

export class StepRunner {
  constructor(private readonly jobs: JobRepository) {}

  async run(jobId: string, stepName: Exclude<WorkflowStep, "approve-outline">): Promise<StepExecutionResult> {
    const detail = await this.jobs.getJobDetail(jobId);
    const paths = this.jobs.getJobPaths(jobId);
    const outputPath = {
      "semantic-map": paths.semanticMapFile,
      outline: paths.outlineFile,
      draft: paths.draftFile,
      "final-optimize": paths.finalOptimizedFile
    }[stepName];
    const promptPath = {
      "semantic-map": `${paths.promptDir}/01-semantic-analysis.md`,
      outline: `${paths.promptDir}/02-outline-generation.md`,
      draft: `${paths.promptDir}/03-blog-draft.md`,
      "final-optimize": `${paths.promptDir}/04-final-optimization.md`
    }[stepName];
    const handoffPath = `${paths.handoffDir}/${stepName}-handoff.md`;

    const prompt = await this.buildPrompt(
      stepName,
      detail.files.intake,
      detail.files.competitorResearch,
      detail.files.semanticMap,
      detail.files.approvedOutline,
      detail.files.draft
    );

    await writeMarkdownFile(promptPath, prompt);
    this.jobs.startStep(jobId, stepName, promptPath, outputPath);

    const codexStatus = await getCodexStatus();
    if (!codexStatus.available || !codexStatus.authenticated) {
      const handoff = await renderManualHandoff(stepName, prompt);
      await writeMarkdownFile(handoffPath, handoff);
      this.jobs.completeStep(jobId, stepName, "manual-input-required", codexStatus.message);
      this.jobs.touchJob(jobId, "manual-input-required");

      return {
        stepName,
        status: "manual-input-required",
        outputPath: null,
        handoffPath,
        message: codexStatus.message
      };
    }

    const result = await runCodexStep({
      cwd: paths.root,
      outputPath,
      prompt
    });

    if (result.exitCode !== 0) {
      const fallback = await renderManualHandoff(stepName, prompt);
      const message = summarizeCodexFailure(result.stdout, result.stderr);
      await writeMarkdownFile(handoffPath, fallback);
      const status = isTransientCodexFailure(result) ? "manual-input-required" : "failed";
      this.jobs.completeStep(jobId, stepName, status, message);
      this.jobs.touchJob(jobId, status === "manual-input-required" ? "manual-input-required" : "error");

      return {
        stepName,
        status,
        outputPath: null,
        handoffPath,
        message
      };
    }

    const generatedOutput = await readTextFile(outputPath);
    if (generatedOutput) {
      await writeMarkdownFile(outputPath, sanitizeGeneratedMarkdown(generatedOutput));
    }

    this.jobs.completeStep(jobId, stepName, "completed");
    this.jobs.touchJob(jobId, nextJobStatusByStep[stepName]);

    return {
      stepName,
      status: "completed",
      outputPath,
      handoffPath: null,
      message: "Step completed successfully."
    };
  }

  async saveApprovedOutline(jobId: string, approvedOutline: string): Promise<StepExecutionResult> {
    const paths = this.jobs.getJobPaths(jobId);
    const generatedOutline = await readTextFile(paths.outlineFile);

    if (!generatedOutline) {
      throw new ApiError("Generate an outline before approving it.", 400, "OUTLINE_REQUIRED");
    }

    await writeMarkdownFile(paths.approvedOutlineFile, approvedOutline);
    this.jobs.completeStep(jobId, "approve-outline", "completed");
    this.jobs.touchJob(jobId, nextJobStatusByStep["approve-outline"]);

    return {
      stepName: "approve-outline",
      status: "completed",
      outputPath: paths.approvedOutlineFile,
      handoffPath: null,
      message: "Approved outline saved."
    };
  }

  private async buildPrompt(
    stepName: Exclude<WorkflowStep, "approve-outline">,
    intake: ArticleIntake | null,
    competitorResearch: CompetitorResearch | null,
    semanticMap: string | null,
    approvedOutline: string | null,
    draft: string | null
  ) {
    if (!intake) {
      throw new ApiError("Save article intake before running this step.", 400, "INTAKE_REQUIRED");
    }

    if (stepName === "semantic-map") {
      return renderStepPrompt("semantic-map", buildSemanticPromptContext(intake, competitorResearch));
    }

    if (!semanticMap) {
      throw new ApiError("Generate the semantic map before running this step.", 400, "SEMANTIC_MAP_REQUIRED");
    }

    if (stepName === "outline") {
      return renderStepPrompt("outline", {
        ARTICLE_BRIEF: buildSemanticPromptContext(intake, competitorResearch).ARTICLE_BRIEF,
        SEMANTIC_MAP: semanticMap
      });
    }

    if (!approvedOutline) {
      throw new ApiError("Approve the outline before running this step.", 400, "APPROVED_OUTLINE_REQUIRED");
    }

    if (stepName === "draft") {
      return renderStepPrompt("draft", {
        ARTICLE_BRIEF: buildSemanticPromptContext(intake, competitorResearch).ARTICLE_BRIEF,
        SEMANTIC_MAP: semanticMap,
        APPROVED_OUTLINE: approvedOutline
      });
    }

    if (!draft) {
      throw new ApiError("Generate the draft before final optimization.", 400, "DRAFT_REQUIRED");
    }

    return renderStepPrompt("final-optimize", {
      ARTICLE_BRIEF: buildSemanticPromptContext(intake, competitorResearch).ARTICLE_BRIEF,
      SEMANTIC_MAP: semanticMap,
      APPROVED_OUTLINE: approvedOutline,
      DRAFT: draft
    });
  }
}
