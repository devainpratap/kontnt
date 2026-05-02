import type { ArticleIntake, CompetitorResearch, JobStatus, StepExecutionResult, WorkflowStep } from "@semantic-seo/shared";

import { readTextFile, writeMarkdownFile } from "../jobs/files";
import { JobRepository } from "../jobs/repository";
import { ApiError } from "../lib/api-error";
import { auditArticleStyle, renderArticleStyleAuditReport, renderArticleStyleRepairPrompt } from "./article-style-audit";
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

    let successMessage = "Step completed successfully.";
    const generatedOutput = await readTextFile(outputPath);
    if (generatedOutput) {
      await writeMarkdownFile(outputPath, sanitizeGeneratedMarkdown(generatedOutput));
      successMessage = await this.repairStyleIssuesIfNeeded(stepName, paths.root, outputPath, paths.outputDir, paths.promptDir);
    }

    this.jobs.completeStep(jobId, stepName, "completed");
    this.jobs.touchJob(jobId, nextJobStatusByStep[stepName]);

    return {
      stepName,
      status: "completed",
      outputPath,
      handoffPath: null,
      message: successMessage
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
    promptDir: string
  ) {
    if (stepName !== "draft" && stepName !== "final-optimize") {
      return "Step completed successfully.";
    }

    const generated = await readTextFile(outputPath);
    if (!generated) {
      return "Step completed successfully.";
    }

    const auditPath = `${outputDir}/${stepName}-style-audit.md`;
    const repairPromptPath = `${promptDir}/${stepName}-style-repair.md`;
    const audit = auditArticleStyle(generated);
    await writeMarkdownFile(auditPath, renderArticleStyleAuditReport(audit));

    if (audit.issues.length === 0) {
      return "Step completed successfully.";
    }

    const repairPrompt = renderArticleStyleRepairPrompt(generated, audit);
    await writeMarkdownFile(repairPromptPath, repairPrompt);
    const repairResult = await runCodexStep({
      cwd,
      outputPath,
      prompt: repairPrompt
    });

    if (repairResult.exitCode !== 0) {
      return `Step completed, but the style repair pass could not run: ${summarizeCodexFailure(repairResult.stdout, repairResult.stderr)}`;
    }

    const repaired = await readTextFile(outputPath);
    if (!repaired) {
      return "Step completed, but the style repair output was not saved.";
    }

    const sanitized = sanitizeGeneratedMarkdown(repaired);
    await writeMarkdownFile(outputPath, sanitized);

    const finalAudit = auditArticleStyle(sanitized);
    await writeMarkdownFile(auditPath, renderArticleStyleAuditReport(finalAudit));

    return finalAudit.issues.length === 0
      ? "Step completed successfully after style audit repair."
      : `Step completed, but style audit still found ${finalAudit.issues.length} issue(s). Review the saved style audit.`;
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
