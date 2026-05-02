import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { FastifyInstance } from "fastify";
import type { JobArtifact, JobDetail, JobSummary } from "@semantic-seo/shared";

let app: FastifyInstance;
let workspaceRoot: string;

const intake = {
  title: "Best Coffee Makers for Small Kitchens",
  targetKeyword: "best coffee maker for small kitchen",
  intendedAudience: "Apartment renters and small kitchen owners",
  searchIntent: "Compare compact coffee makers and understand the best fit by use case.",
  topRankingUrls: ["https://example.com/coffee-makers"],
  competitorNotes: "Competitors cover product lists but miss space planning and cleaning tradeoffs.",
  mainEntities: ["compact coffee maker", "counter space", "brew size"],
  secondaryEntities: ["thermal carafe", "single serve", "pour over"],
  brandContext: "Neutral editorial article with practical buying advice.",
  attributes: ["small footprint", "easy cleaning", "price range", "brew quality"],
  anchorKeywords: ["compact coffee maker", "small kitchen coffee machine"],
  tone: "clear, practical, expert",
  targetWordCount: 1200,
  internalLinks: ["https://example.com/kitchen-storage"],
  preferredCtas: ["Compare compact models"]
};

before(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "semantic-seo-routes-"));
  process.env.WORKFLOW_ROOT = workspaceRoot;
  process.env.DB_PATH = join(workspaceRoot, "data", "workflow.sqlite");
  process.env.HOST = "127.0.0.1";
  await mkdir(join(workspaceRoot, "data"), { recursive: true });

  const [{ createServer }, { ensureWorkspaceDirs }, { initializeDatabase }] = await Promise.all([
    import("./app"),
    import("./config"),
    import("./db/client")
  ]);

  await ensureWorkspaceDirs();
  initializeDatabase();
  app = await createServer();
});

after(async () => {
  await app?.close();
  await rm(workspaceRoot, { recursive: true, force: true });
});

async function createJob() {
  const response = await app.inject({
    method: "POST",
    url: "/api/jobs",
    payload: {
      title: intake.title
    }
  });

  assert.equal(response.statusCode, 201);
  return response.json<JobSummary>();
}

describe("core job routes", () => {
  it("creates a job with workflow steps", async () => {
    const job = await createJob();
    const detailResponse = await app.inject(`/api/jobs/${job.id}`);
    const detail = detailResponse.json<JobDetail>();

    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detail.job.title, intake.title);
    assert.equal(detail.steps.length, 5);
    assert.ok(detail.job.jobPath.startsWith(workspaceRoot));
  });

  it("validates intake payloads and persists valid article intake", async () => {
    const job = await createJob();
    const invalidResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/intake`,
      payload: {
        intake: {
          ...intake,
          title: "",
          topRankingUrls: ["not-a-url"]
        }
      }
    });

    assert.equal(invalidResponse.statusCode, 400);

    const saveResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/intake`,
      payload: {
        intake
      }
    });
    assert.equal(saveResponse.statusCode, 200);

    const detailResponse = await app.inject(`/api/jobs/${job.id}`);
    const detail = detailResponse.json<JobDetail>();
    assert.equal(detail.files.intake?.title, intake.title);
    assert.deepEqual(detail.files.intake?.mainEntities, intake.mainEntities);
  });

  it("lists saved artifacts and serves output files", async () => {
    const job = await createJob();
    const detailResponse = await app.inject(`/api/jobs/${job.id}`);
    const detail = detailResponse.json<JobDetail>();
    const finalArticlePath = join(detail.job.jobPath, "outputs", "final-optimized-blog.md");

    await writeFile(
      finalArticlePath,
      ["# Compact Coffee Maker Guide", "", "## Key Takeaways", "", "- Measure counter depth first", "- Match capacity to daily use"].join("\n"),
      "utf8"
    );

    const artifactsResponse = await app.inject(`/api/jobs/${job.id}/artifacts`);
    const artifacts = artifactsResponse.json<JobArtifact[]>();
    const finalArtifact = artifacts.find((artifact) => artifact.type === "final-optimized");

    assert.equal(artifactsResponse.statusCode, 200);
    assert.equal(finalArtifact?.exists, true);
    assert.equal(finalArtifact?.category, "output");
    assert.match(finalArtifact?.downloadUrl ?? "", /download=1/);

    const fileResponse = await app.inject(`/api/jobs/${job.id}/files/final-optimized`);
    assert.equal(fileResponse.statusCode, 200);
    assert.match(fileResponse.headers["content-type"]?.toString() ?? "", /text\/markdown/);
    assert.match(fileResponse.body, /Compact Coffee Maker Guide/);

    const downloadResponse = await app.inject(`/api/jobs/${job.id}/files/final-optimized?download=1`);
    assert.equal(downloadResponse.statusCode, 200);
    assert.match(downloadResponse.headers["content-disposition"]?.toString() ?? "", /attachment/);
  });

  it("exports final articles as markdown, HTML, and DOCX", async () => {
    const job = await createJob();
    const detailResponse = await app.inject(`/api/jobs/${job.id}`);
    const detail = detailResponse.json<JobDetail>();
    const finalArticlePath = join(detail.job.jobPath, "outputs", "final-optimized-blog.md");

    await writeFile(
      finalArticlePath,
      ["# Compact Coffee Maker Guide", "", "## Buying Checklist", "", "- Small footprint", "- Easy cleaning"].join("\n"),
      "utf8"
    );

    const markdownResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/export`,
      payload: {
        format: "markdown"
      }
    });
    assert.equal(markdownResponse.statusCode, 200);
    assert.equal(markdownResponse.json().format, "markdown");

    const htmlResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/export`,
      payload: {
        format: "html"
      }
    });
    assert.equal(htmlResponse.statusCode, 200);
    assert.equal(htmlResponse.json().format, "html");

    const exportedHtmlResponse = await app.inject(`/api/jobs/${job.id}/files/export-html`);
    assert.equal(exportedHtmlResponse.statusCode, 200);
    assert.match(exportedHtmlResponse.headers["content-type"]?.toString() ?? "", /text\/html/);
    assert.match(exportedHtmlResponse.body, /<ul>\n<li>Small footprint<\/li>\n<li>Easy cleaning<\/li>\n<\/ul>/);

    const docxResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/export`,
      payload: {
        format: "docx"
      }
    });
    assert.equal(docxResponse.statusCode, 200);
    assert.equal(docxResponse.json().format, "docx");

    const artifactsResponse = await app.inject(`/api/jobs/${job.id}/artifacts`);
    const artifacts = artifactsResponse.json<JobArtifact[]>();
    const docxArtifact = artifacts.find((artifact) => artifact.type === "export-docx");
    assert.equal(docxArtifact?.exists, true);
    assert.match(docxArtifact?.downloadUrl ?? "", /export-docx\?download=1/);

    const exportedDocxResponse = await app.inject(`/api/jobs/${job.id}/files/export-docx?download=1`);
    assert.equal(exportedDocxResponse.statusCode, 200);
    assert.match(exportedDocxResponse.headers["content-type"]?.toString() ?? "", /officedocument\.wordprocessingml\.document/);
    assert.match(exportedDocxResponse.headers["content-disposition"]?.toString() ?? "", /final-article\.docx/);
    assert.ok(exportedDocxResponse.rawPayload.length > 1000);
  });

  it("returns a clear export error until final optimization exists", async () => {
    const job = await createJob();
    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/export`,
      payload: {
        format: "markdown"
      }
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "FINAL_ARTICLE_REQUIRED");
  });
});
