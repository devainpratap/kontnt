import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  appSettingsSchema,
  approveOutlineSchema,
  createJobSchema,
  exportArticleSchema,
  saveIntakeSchema,
  type WorkflowStep
} from "@semantic-seo/shared";

import { appConfig } from "./config";
import { exportFinalArticle } from "./export/article-exporter";
import { extractCompetitorResearch } from "./extraction/competitor-research";
import { readJsonFile, readTextFile, writeJsonFile } from "./jobs/files";
import { JobRepository } from "./jobs/repository";
import { ApiError } from "./lib/api-error";
import { getCodexStatus } from "./generation/codex-provider";
import { StepRunner } from "./generation/step-runner";

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

async function getFileSize(path: string) {
  try {
    const fileStat = await stat(path);
    return fileStat.size;
  } catch {
    return null;
  }
}

export async function registerRoutes(app: FastifyInstance) {
  const jobs = new JobRepository();
  const runner = new StepRunner(jobs);

  app.get("/api/health", async () => {
    const codex = await getCodexStatus();
    return {
      ok: true,
      codex,
      workspaceRoot: appConfig.workspaceRoot
    };
  });

  app.get("/api/settings", async () => {
    const codex = await getCodexStatus();
    return appSettingsSchema.parse({
      generationMode: codex.available && codex.authenticated ? "codex" : appConfig.fallbackMode,
      codexAvailable: codex.available,
      codexAuthenticated: codex.authenticated,
      workspaceRoot: appConfig.workspaceRoot,
      jobsRoot: appConfig.jobsRoot
    });
  });

  app.get("/api/jobs", async () => jobs.listJobs());

  app.post("/api/jobs", async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid job payload.");
    }

    const job = await jobs.createJob(parsed.data.title);
    return reply.code(201).send(job);
  });

  app.get("/api/jobs/:jobId", async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    return jobs.getJobDetail(request.params.jobId);
  });

  app.post("/api/jobs/:jobId/intake", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply) => {
    const parsed = saveIntakeSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid intake payload.");
    }

    const paths = jobs.getJobPaths(request.params.jobId);
    await writeJsonFile(paths.intakeFile, parsed.data.intake);
    jobs.touchJob(request.params.jobId, "draft");

    return {
      ok: true
    };
  });

  app.post("/api/jobs/:jobId/extract-competitors", async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    const detail = await jobs.getJobDetail(request.params.jobId);
    const intake = detail.files.intake;

    if (!intake) {
      throw new ApiError("Save article intake before extracting competitors.", 400, "INTAKE_REQUIRED");
    }

    if (intake.topRankingUrls.length === 0) {
      throw new ApiError("Add at least one top-ranking URL before extracting competitors.", 400, "TOP_RANKING_URLS_REQUIRED");
    }

    const paths = jobs.getJobPaths(request.params.jobId);
    const competitorResearch = await extractCompetitorResearch(intake.topRankingUrls);
    await writeJsonFile(paths.competitorResearchFile, competitorResearch);
    jobs.touchJob(request.params.jobId);

    return {
      ok: true,
      competitorResearch
    };
  });

  app.post("/api/jobs/:jobId/steps/semantic-map", async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    return runner.run(request.params.jobId, "semantic-map");
  });

  app.post("/api/jobs/:jobId/steps/outline", async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    return runner.run(request.params.jobId, "outline");
  });

  app.post("/api/jobs/:jobId/steps/approve-outline", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply) => {
    const parsed = approveOutlineSchema.safeParse(request.body);
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid approved outline payload.");
    }

    return runner.saveApprovedOutline(request.params.jobId, parsed.data.approvedOutline);
  });

  app.post("/api/jobs/:jobId/steps/draft", async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    return runner.run(request.params.jobId, "draft");
  });

  app.post("/api/jobs/:jobId/steps/final-optimize", async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    return runner.run(request.params.jobId, "final-optimize");
  });

  app.post("/api/jobs/:jobId/export", async (request: FastifyRequest<{ Params: { jobId: string } }>, reply) => {
    const parsed = exportArticleSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, parsed.error.issues[0]?.message ?? "Invalid export payload.");
    }

    const paths = jobs.getJobPaths(request.params.jobId);
    return exportFinalArticle({
      sourcePath: paths.finalOptimizedFile,
      markdownExportPath: paths.markdownExportFile,
      htmlExportPath: paths.htmlExportFile,
      docxExportPath: paths.docxExportFile,
      format: parsed.data.format
    });
  });

  app.get("/api/jobs/:jobId/artifacts", async (request: FastifyRequest<{ Params: { jobId: string } }>) => {
    const paths = jobs.getJobPaths(request.params.jobId);
    const baseUrl = `/api/jobs/${request.params.jobId}/files`;
    const artifacts = [
      { type: "intake", label: "Intake brief", category: "input" as const, path: paths.intakeFile },
      { type: "competitor-research", label: "Competitor research", category: "input" as const, path: paths.competitorResearchFile },
      { type: "semantic-map", label: "Semantic map", category: "output" as const, path: paths.semanticMapFile },
      { type: "outline", label: "Generated outline", category: "output" as const, path: paths.outlineFile },
      { type: "approved-outline", label: "Approved outline", category: "output" as const, path: paths.approvedOutlineFile },
      { type: "draft", label: "Article draft", category: "output" as const, path: paths.draftFile },
      { type: "final-optimized", label: "Final optimized article", category: "output" as const, path: paths.finalOptimizedFile },
      { type: "export-markdown", label: "Markdown export", category: "export" as const, path: paths.markdownExportFile },
      { type: "export-html", label: "HTML export", category: "export" as const, path: paths.htmlExportFile },
      { type: "export-docx", label: "DOCX export", category: "export" as const, path: paths.docxExportFile }
    ];

    return Promise.all(
      artifacts.map(async (artifact) => {
        const sizeBytes = await getFileSize(artifact.path);
        return {
          ...artifact,
          exists: sizeBytes !== null,
          sizeBytes,
          url: `${baseUrl}/${artifact.type}`,
          downloadUrl: `${baseUrl}/${artifact.type}?download=1`
        };
      })
    );
  });

  app.get("/api/jobs/:jobId/files/:type", async (request: FastifyRequest<{ Params: { jobId: string; type: string }; Querystring: { download?: string } }>, reply) => {
    const paths = jobs.getJobPaths(request.params.jobId);
    const fileMap: Record<string, string> = {
      intake: paths.intakeFile,
      "competitor-research": paths.competitorResearchFile,
      "semantic-map": paths.semanticMapFile,
      outline: paths.outlineFile,
      "approved-outline": paths.approvedOutlineFile,
      draft: paths.draftFile,
      "final-optimized": paths.finalOptimizedFile,
      "export-markdown": paths.markdownExportFile,
      "export-html": paths.htmlExportFile,
      "export-docx": paths.docxExportFile
    };

    if (request.params.type.startsWith("handoff:")) {
      const stepName = request.params.type.replace("handoff:", "") as WorkflowStep;
      const content = await readTextFile(`${paths.handoffDir}/${stepName}-handoff.md`);
      if (!content) {
        return reply.code(404).send({ error: "Handoff not found." });
      }
      return reply.type("text/markdown").send(content);
    }

    const filePath = fileMap[request.params.type];
    if (!filePath) {
      return reply.code(404).send({ error: "Unsupported file type." });
    }

    if (request.params.type === "intake" || request.params.type === "competitor-research") {
      const content = await readJsonFile(filePath);
      if (request.query.download === "1") {
        reply.header("Content-Disposition", `attachment; filename="${basename(filePath)}"`);
      }
      return content ? reply.send(content) : reply.code(404).send({ error: "File not found." });
    }

    if (request.query.download === "1") {
      reply.header("Content-Disposition", `attachment; filename="${basename(filePath)}"`);
    }

    if (request.params.type === "export-docx") {
      try {
        const content = await readFile(filePath);
        return reply.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document").send(content);
      } catch {
        return reply.code(404).send({ error: "File not found." });
      }
    }

    const content = await readTextFile(filePath);
    if (!content) {
      return reply.code(404).send({ error: "File not found." });
    }

    if (request.params.type === "export-html") {
      return reply.type("text/html").send(content);
    }

    return reply.type("text/markdown").send(content);
  });
}
