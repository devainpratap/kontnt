import type { ArticleIntake, CompetitorResearch, JobStatus, StepExecutionResult, WorkflowStep } from "@semantic-seo/shared";

import { readTextFile, writeMarkdownFile } from "../jobs/files";
import { JobRepository } from "../jobs/repository";
import { ApiError } from "../lib/api-error";
import { auditArticleStructure, renderArticleStructureAuditReport, renderArticleStructureRepairPrompt } from "./article-structure-audit";
import { auditArticleStyle, renderArticleStyleAuditReport, renderArticleStyleRepairPrompt } from "./article-style-audit";
import { generationProviderLabel, getGenerationStatus, isTransientGenerationFailure, runGenerationStep } from "./provider";
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

// Internal sentinel used to unwind the pipeline (including the audit-and-repair
// loop) cleanly when the caller aborts. Caught in run() and mapped to a
// persisted "failed" step with a "Cancelled by user" message.
class StepCancelledError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "StepCancelledError";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new StepCancelledError();
  }
}

function summarizeGenerationFailure(stdout: string, stderr: string) {
  const combined = `${stderr}\n${stdout}`.trim();

  // Codex phrases a quota hit this way; the Claude SDK surfaces it as a 429
  // rate-limit error. Either way, tell the user it is a usage limit.
  if (combined.includes("You've hit your usage limit")) {
    const match = combined.match(/You've hit your usage limit[^\n]*/);
    return match?.[0] ?? `${generationProviderLabel} usage limit reached.`;
  }

  if (/rate.?limit|\b429\b/i.test(combined)) {
    return `${generationProviderLabel} usage limit reached. Try again shortly.`;
  }

  return combined.slice(0, 1200) || `${generationProviderLabel} generation failed.`;
}

export class StepRunner {
  constructor(private readonly jobs: JobRepository) {}

  /**
   * Cheap, synchronous-enough prerequisite check that mirrors the guards in
   * buildPrompt. Routes call this BEFORE starting the detached run so missing
   * intake / semantic map / approved outline / draft still yields an immediate
   * ApiError (4xx) to the HTTP caller instead of failing silently in the
   * background. buildPrompt keeps its own guards as a defensive backstop.
   */
  async validatePrerequisites(jobId: string, stepName: Exclude<WorkflowStep, "approve-outline">): Promise<void> {
    const detail = await this.jobs.getJobDetail(jobId);
    const { intake, semanticMap, approvedOutline, draft } = detail.files;

    if (!intake) {
      throw new ApiError("Save article intake before running this step.", 400, "INTAKE_REQUIRED");
    }

    if (stepName === "semantic-map") {
      return;
    }

    if (!semanticMap) {
      throw new ApiError("Generate the semantic map before running this step.", 400, "SEMANTIC_MAP_REQUIRED");
    }

    if (stepName === "outline") {
      return;
    }

    if (!approvedOutline) {
      throw new ApiError("Approve the outline before running this step.", 400, "APPROVED_OUTLINE_REQUIRED");
    }

    if (stepName === "draft") {
      return;
    }

    if (!draft) {
      throw new ApiError("Generate the draft before final optimization.", 400, "DRAFT_REQUIRED");
    }
  }

  async run(jobId: string, stepName: Exclude<WorkflowStep, "approve-outline">, signal?: AbortSignal): Promise<StepExecutionResult> {
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
      jobId,
      stepName,
      detail.files.intake,
      detail.files.competitorResearch,
      detail.files.semanticMap,
      detail.files.approvedOutline,
      detail.files.draft
    );

    await writeMarkdownFile(promptPath, prompt);
    this.jobs.startStep(jobId, stepName, promptPath, outputPath);

    try {
      throwIfAborted(signal);

      const providerStatus = await getGenerationStatus();
      if (!providerStatus.available || !providerStatus.authenticated) {
        const handoff = await renderManualHandoff(stepName, prompt);
        await writeMarkdownFile(handoffPath, handoff);
        this.jobs.completeStep(jobId, stepName, "manual-input-required", providerStatus.message);
        this.jobs.touchJob(jobId, "manual-input-required");

        return {
          stepName,
          status: "manual-input-required",
          outputPath: null,
          handoffPath,
          message: providerStatus.message
        };
      }

      throwIfAborted(signal);

      const result = await runGenerationStep({
        cwd: paths.root,
        outputPath,
        prompt,
        signal
      });

      // A cancellation that landed mid-Codex returns a non-zero result; surface
      // it as a clean "failed / Cancelled by user" rather than a manual handoff.
      throwIfAborted(signal);

      if (result.exitCode !== 0) {
        const fallback = await renderManualHandoff(stepName, prompt);
        const message = summarizeGenerationFailure(result.stdout, result.stderr);
        await writeMarkdownFile(handoffPath, fallback);
        const status = isTransientGenerationFailure(result) ? "manual-input-required" : "failed";
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
      if (!isGeneratedOutputAcceptable(stepName, generatedOutput)) {
        const fallback = await renderManualHandoff(stepName, prompt);
        const message = `${generationProviderLabel} returned empty or incomplete output.`;
        await writeMarkdownFile(handoffPath, fallback);
        this.jobs.completeStep(jobId, stepName, "manual-input-required", message);
        this.jobs.touchJob(jobId, "manual-input-required");

        return {
          stepName,
          status: "manual-input-required",
          outputPath: null,
          handoffPath,
          message
        };
      }

      await writeMarkdownFile(outputPath, sanitizeGeneratedMarkdown(generatedOutput));
      const successMessage = await this.repairPostGenerationIssuesIfNeeded(stepName, detail.files.intake, paths.root, outputPath, paths.outputDir, paths.promptDir, signal);

      this.jobs.completeStep(jobId, stepName, "completed");
      this.jobs.touchJob(jobId, nextJobStatusByStep[stepName]);

      return {
        stepName,
        status: "completed",
        outputPath,
        handoffPath: null,
        message: successMessage
      };
    } catch (error) {
      if (error instanceof StepCancelledError) {
        const message = "Cancelled by user";
        this.jobs.completeStep(jobId, stepName, "failed", message);
        this.jobs.touchJob(jobId, "error");

        return {
          stepName,
          status: "failed",
          outputPath: null,
          handoffPath: null,
          message
        };
      }

      throw error;
    }
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
    jobId: string,
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
        SEMANTIC_MAP: semanticMap,
        RECENT_STRUCTURE_PATTERNS: await this.buildRecentStructurePatterns(jobId)
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

  private async repairStyleIssuesIfNeeded(
    stepName: Exclude<WorkflowStep, "approve-outline">,
    cwd: string,
    outputPath: string,
    outputDir: string,
    promptDir: string,
    signal?: AbortSignal
  ) {
    if (stepName !== "draft" && stepName !== "final-optimize") {
      return "Step completed successfully.";
    }

    const generated = await readTextFile(outputPath);
    if (!generated) {
      return "Step completed successfully.";
    }

    const auditPath = `${outputDir}/${stepName}-style-audit.md`;
    const initialAudit = auditArticleStyle(generated);
    await writeMarkdownFile(auditPath, renderArticleStyleAuditReport(initialAudit));

    if (initialAudit.issues.length === 0) {
      return "Step completed successfully.";
    }

    let currentMarkdown = generated;
    let currentAudit = initialAudit;
    const maxRepairPasses = 2;

    for (let pass = 1; pass <= maxRepairPasses; pass += 1) {
      throwIfAborted(signal);
      const repairPromptPath = `${promptDir}/${stepName}-style-repair-pass-${pass}.md`;
      const repairPrompt = renderArticleStyleRepairPrompt(currentMarkdown, currentAudit);
      await writeMarkdownFile(repairPromptPath, repairPrompt);
      const repairResult = await runGenerationStep({
        cwd,
        outputPath,
        prompt: repairPrompt,
        signal
      });
      throwIfAborted(signal);

      if (repairResult.exitCode !== 0) {
        return `Step completed, but style repair pass ${pass} could not run: ${summarizeGenerationFailure(repairResult.stdout, repairResult.stderr)}`;
      }

      const repaired = await readTextFile(outputPath);
      if (!repaired) {
        return `Step completed, but style repair pass ${pass} did not save output.`;
      }

      currentMarkdown = sanitizeGeneratedMarkdown(repaired);
      await writeMarkdownFile(outputPath, currentMarkdown);
      currentAudit = auditArticleStyle(currentMarkdown);
      await writeMarkdownFile(auditPath, renderArticleStyleAuditReport(currentAudit));

      if (currentAudit.issues.length === 0) {
        return pass === 1
          ? "Step completed successfully after style audit repair."
          : `Step completed successfully after ${pass} style audit repair passes.`;
      }
    }

    return `Step completed, but style audit still found ${currentAudit.issues.length} issue(s) after ${maxRepairPasses} repair passes. Review the saved style audit.`;
  }

  private async repairPostGenerationIssuesIfNeeded(
    stepName: Exclude<WorkflowStep, "approve-outline">,
    intake: ArticleIntake | null,
    cwd: string,
    outputPath: string,
    outputDir: string,
    promptDir: string,
    signal?: AbortSignal
  ) {
    if (stepName === "outline" && intake) {
      return this.repairStructureIssuesIfNeeded(intake, cwd, outputPath, outputDir, promptDir, signal);
    }

    return this.repairStyleIssuesIfNeeded(stepName, cwd, outputPath, outputDir, promptDir, signal);
  }

  private async repairStructureIssuesIfNeeded(
    intake: ArticleIntake,
    cwd: string,
    outputPath: string,
    outputDir: string,
    promptDir: string,
    signal?: AbortSignal
  ) {
    const generated = await readTextFile(outputPath);
    if (!generated) {
      return "Step completed successfully.";
    }

    const auditPath = `${outputDir}/outline-structure-audit.md`;
    const repairPromptPath = `${promptDir}/outline-structure-repair.md`;
    const audit = auditArticleStructure(intake, generated);
    await writeMarkdownFile(auditPath, renderArticleStructureAuditReport(audit));

    if (audit.issues.length === 0) {
      return "Step completed successfully.";
    }

    throwIfAborted(signal);
    const repairPrompt = renderArticleStructureRepairPrompt(intake, generated, audit);
    await writeMarkdownFile(repairPromptPath, repairPrompt);
    const repairResult = await runGenerationStep({
      cwd,
      outputPath,
      prompt: repairPrompt,
      signal
    });
    throwIfAborted(signal);

    if (repairResult.exitCode !== 0) {
      return `Step completed, but the outline structure repair pass could not run: ${summarizeGenerationFailure(repairResult.stdout, repairResult.stderr)}`;
    }

    const repaired = await readTextFile(outputPath);
    if (!repaired) {
      return "Step completed, but the outline structure repair output was not saved.";
    }

    const sanitized = sanitizeGeneratedMarkdown(repaired);
    await writeMarkdownFile(outputPath, sanitized);

    const finalAudit = auditArticleStructure(intake, sanitized);
    await writeMarkdownFile(auditPath, renderArticleStructureAuditReport(finalAudit));

    return finalAudit.issues.length === 0
      ? "Step completed successfully after outline structure audit repair."
      : `Step completed, but outline structure audit still found ${finalAudit.issues.length} issue(s). Review the saved structure audit.`;
  }

  private async buildRecentStructurePatterns(currentJobId: string) {
    const recentJobs = this.jobs.listJobs().filter((job) => job.id !== currentJobId).slice(0, 4);
    const summaries = await Promise.all(
      recentJobs.map(async (job) => {
        const paths = this.jobs.getJobPaths(job.id);
        const markdown = (await readTextFile(paths.finalOptimizedFile)) ?? (await readTextFile(paths.outlineFile));
        if (!markdown) {
          return null;
        }

        return summarizeStructurePattern(job.title, markdown);
      })
    );

    const usableSummaries = summaries.filter(Boolean);
    if (usableSummaries.length === 0) {
      return "No previous article structure patterns are available yet.";
    }

    return [
      "Recent article structure patterns to avoid copying too closely:",
      "",
      ...usableSummaries
    ].join("\n\n");
  }
}

// Guard against Codex exiting 0 but writing empty or truncated output. Article steps
// (outline/draft/final-optimize) must contain at least one Markdown heading and a
// minimal amount of prose; the semantic map is structured but shorter, so it only has
// to be non-trivially long. Thresholds stay conservative to avoid false triggers on
// legitimately compact output.
function isGeneratedOutputAcceptable(
  stepName: Exclude<WorkflowStep, "approve-outline">,
  output: string | null
): output is string {
  if (!output) {
    return false;
  }

  const trimmed = output.trim();
  if (trimmed.length < 40) {
    return false;
  }

  if (stepName === "outline" || stepName === "draft" || stepName === "final-optimize") {
    if (!/^#{1,6}\s+\S/m.test(trimmed)) {
      return false;
    }

    if (trimmed.length < 200) {
      return false;
    }
  }

  return true;
}

function summarizeStructurePattern(title: string, markdown: string) {
  const h2s = Array.from(markdown.matchAll(/^##\s+(.+)$/gm)).map((match) => match[1].trim()).filter((heading) => heading !== "Key Takeaways");
  const h3Count = Array.from(markdown.matchAll(/^###\s+/gm)).length;
  const tableCount = markdown.split("\n").filter((line) => /^\|.+\|$/.test(line.trim())).length > 0 ? Array.from(markdown.matchAll(/\n\|[-:\s|]+\|\n/g)).length : 0;
  const bulletSections = Array.from(markdown.matchAll(/^##\s+(.+)$([\s\S]*?)(?=^##\s+|\s*$)/gm))
    .filter((match) => match[2].split("\n").filter((line) => line.trim().startsWith("- ")).length >= 4)
    .map((match) => match[1].trim());

  return [
    `Title: ${title}`,
    `H2 flow: ${h2s.slice(0, 12).join(" | ") || "No H2 headings found"}`,
    `H2 count: ${h2s.length}`,
    `H3 count: ${h3Count}`,
    `Table count: ${tableCount}`,
    `Bullet-heavy sections: ${bulletSections.slice(0, 5).join(" | ") || "None"}`
  ].join("\n");
}
