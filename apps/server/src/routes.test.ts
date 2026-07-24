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

  it("rejects handoff path traversal payloads without touching the filesystem", async () => {
    const job = await createJob();

    const encodedResponse = await app.inject(
      `/api/jobs/${job.id}/files/${encodeURIComponent("handoff:../../../../etc/passwd")}`
    );
    assert.equal(encodedResponse.statusCode, 404);
    assert.equal(encodedResponse.json().error, "Handoff not found.");

    // Unencoded traversal is collapsed by URL normalisation before the request
    // reaches Fastify, so the server sees a plain (unknown) file type rather
    // than a handoff. Either way it must 404 without touching the filesystem.
    const plainResponse = await app.inject(`/api/jobs/${job.id}/files/handoff:../../foo`);
    assert.equal(plainResponse.statusCode, 404);
    assert.equal(plainResponse.json().error, "Unsupported file type.");
  });

  it("serves valid handoff files by workflow step name", async () => {
    const job = await createJob();
    const detailResponse = await app.inject(`/api/jobs/${job.id}`);
    const detail = detailResponse.json<JobDetail>();
    const handoffPath = join(detail.job.jobPath, "handoffs", "draft-handoff.md");

    await mkdir(join(detail.job.jobPath, "handoffs"), { recursive: true });
    await writeFile(handoffPath, "# Draft handoff\n\nReady for review.\n", "utf8");

    const response = await app.inject(`/api/jobs/${job.id}/files/handoff:draft`);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"]?.toString() ?? "", /text\/markdown/);
    assert.match(response.body, /Draft handoff/);
  });

  it("exposes audit reports as artifacts and serves them as markdown", async () => {
    const job = await createJob();
    const detailResponse = await app.inject(`/api/jobs/${job.id}`);
    const detail = detailResponse.json<JobDetail>();
    const outputsDir = join(detail.job.jobPath, "outputs");

    await mkdir(outputsDir, { recursive: true });
    await writeFile(join(outputsDir, "draft-style-audit.md"), "# Draft style audit\n", "utf8");
    await writeFile(join(outputsDir, "final-optimize-style-audit.md"), "# Final style audit\n", "utf8");
    await writeFile(join(outputsDir, "outline-structure-audit.md"), "# Outline structure audit\n", "utf8");

    const artifactsResponse = await app.inject(`/api/jobs/${job.id}/artifacts`);
    const artifacts = artifactsResponse.json<JobArtifact[]>();

    const auditContract: Array<{ type: string; label: string; heading: RegExp }> = [
      { type: "style-audit-draft", label: "Draft style audit", heading: /Draft style audit/ },
      { type: "style-audit-final", label: "Final style audit", heading: /Final style audit/ },
      { type: "structure-audit-outline", label: "Outline structure audit", heading: /Outline structure audit/ }
    ];

    for (const entry of auditContract) {
      const artifact = artifacts.find((item) => item.type === entry.type);
      assert.ok(artifact, `expected artifact ${entry.type}`);
      assert.equal(artifact?.category, "audit");
      assert.equal(artifact?.label, entry.label);
      assert.equal(artifact?.exists, true);
      assert.match(artifact?.url ?? "", new RegExp(`/files/${entry.type}$`));

      const fileResponse = await app.inject(`/api/jobs/${job.id}/files/${entry.type}`);
      assert.equal(fileResponse.statusCode, 200);
      assert.match(fileResponse.headers["content-type"]?.toString() ?? "", /text\/markdown/);
      assert.match(fileResponse.body, entry.heading);
    }
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

describe("fire-and-poll step execution (issue #6)", () => {
  it("surfaces missing prerequisites as an immediate 4xx before firing", async () => {
    const job = await createJob();

    // No intake saved yet: prerequisite validation runs in the request, so the
    // caller gets an immediate 400 rather than a background failure.
    const semanticMapResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/steps/semantic-map`
    });
    assert.equal(semanticMapResponse.statusCode, 400);
    assert.equal(semanticMapResponse.json().code, "INTAKE_REQUIRED");

    // Later steps also validate their own upstream prerequisites.
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/intake`,
      payload: { intake }
    });

    const outlineResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/steps/outline`
    });
    assert.equal(outlineResponse.statusCode, 400);
    assert.equal(outlineResponse.json().code, "SEMANTIC_MAP_REQUIRED");

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/steps/draft`
    });
    assert.equal(draftResponse.statusCode, 400);
    assert.equal(draftResponse.json().code, "SEMANTIC_MAP_REQUIRED");
  });

  it("returns 202 immediately when prerequisites are satisfied", async () => {
    const job = await createJob();
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/intake`,
      payload: { intake }
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/steps/semantic-map`
    });

    // Fire-and-poll: the request returns without awaiting the multi-minute run.
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.json(), { status: "running", stepName: "semantic-map" });
  });

  it("validates the step name and reports nothing to cancel when idle", async () => {
    const job = await createJob();

    const unknownStep = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/steps/not-a-step/cancel`
    });
    assert.equal(unknownStep.statusCode, 404);
    assert.equal(unknownStep.json().error, "Unknown workflow step.");

    const idleCancel = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/steps/draft/cancel`
    });
    assert.equal(idleCancel.statusCode, 200);
    assert.deepEqual(idleCancel.json(), { cancelled: false });
  });
});
