import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";

import type { ExportFormat, JobArtifact, JobDetail, WorkflowStep } from "@semantic-seo/shared";

import { Surface, SurfaceHeader } from "../components/Surface";
import { StatusPill } from "../components/StatusPill";
import { WorkflowStepCard } from "../components/WorkflowStepCard";
import { FieldShell, ReadOnlyArea, inputClassName } from "../components/TextField";
import { api } from "../lib/api";
import { splitUrlInput, toFormValues, toIntakePayload, type IntakeFormValues } from "../lib/intake";
import { getCurrentStep, getStepRecord, workflowPhases, workflowStepMeta, workflowStepOrder } from "../lib/workflow";

type CompetitorEntry = {
  status: "completed" | "failed";
  title: string;
  url?: string;
  metaDescription?: string;
  excerpt?: string;
  errorMessage?: string | null;
  extractionSource?: string;
  highlights: string[];
};

type RunnableStep = Exclude<WorkflowStep, "approve-outline">;

const exportLabels: Record<ExportFormat, string> = {
  markdown: "Markdown",
  html: "HTML",
  docx: "DOCX"
};

const exportFormatByArtifactType: Record<string, ExportFormat> = {
  "export-markdown": "markdown",
  "export-html": "html",
  "export-docx": "docx"
};

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString();
}

function formatBytes(value: number | null) {
  if (value === null) {
    return "";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  return `${Math.round(value / 1024)} KB`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function getStepContent(job: JobDetail | undefined, stepName: WorkflowStep) {
  if (!job) {
    return "";
  }

  if (stepName === "semantic-map") {
    return job.files.semanticMap ?? job.files.handoffs[stepName] ?? "";
  }

  if (stepName === "outline" || stepName === "approve-outline") {
    return job.files.approvedOutline ?? job.files.outline ?? job.files.handoffs[stepName] ?? job.files.handoffs.outline ?? "";
  }

  if (stepName === "draft") {
    return job.files.draft ?? job.files.handoffs[stepName] ?? "";
  }

  return job.files.finalOptimized ?? job.files.handoffs[stepName] ?? "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseCompetitorEntry(value: unknown): CompetitorEntry | null {
  if (!isObject(value)) {
    return null;
  }

  const title = readString(value.title) ?? readString(value.name) ?? readString(value.domain) ?? readString(value.url) ?? "Competitor source";
  const url = readString(value.url);
  const status = value.status === "failed" ? "failed" : "completed";
  const metaDescription = readString(value.metaDescription) ?? readString(value.description);
  const excerpt = readString(value.excerpt) ?? readString(value.summary) ?? readString(value.notes);
  const errorMessage = readString(value.errorMessage) ?? null;
  const extractionSource = readString(value.extractionSource);
  const highlights = [
    ...readStringList(value.highlights),
    ...readStringList(value.gaps),
    ...readStringList(value.headings),
    ...readStringList(value.entities)
  ].slice(0, 6);

  return {
    status,
    title,
    url,
    metaDescription,
    excerpt,
    errorMessage,
    extractionSource,
    highlights
  };
}

function getCompetitorEntries(job: JobDetail | undefined) {
  if (!job) {
    return [];
  }

  const sources: unknown[] = [];
  const extraFiles = job.files as typeof job.files & Record<string, unknown>;
  const extraJob = job as JobDetail & Record<string, unknown>;

  const directCandidates = [
    extraFiles.competitorResearch,
    extraFiles.competitorExtraction,
    extraFiles.competitors,
    extraJob.competitorResearch,
    extraJob.competitorExtraction,
    extraJob.competitors
  ];

  directCandidates.forEach((candidate) => {
    if (Array.isArray(candidate)) {
      sources.push(...candidate);
    } else if (isObject(candidate) && Array.isArray(candidate.results)) {
      sources.push(...candidate.results);
    } else if (isObject(candidate) && Array.isArray(candidate.competitors)) {
      sources.push(...candidate.competitors);
    }
  });

  return sources.map(parseCompetitorEntry).filter((entry): entry is CompetitorEntry => Boolean(entry));
}

export function JobWorkspacePage() {
  const { jobId = "" } = useParams();
  const queryClient = useQueryClient();
  const [outlineDraft, setOutlineDraft] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob(jobId),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (query.state.data?.steps.some((step) => step.status === "running") ? 2500 : false)
  });

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", jobId],
    queryFn: () => api.listArtifacts(jobId),
    enabled: Boolean(jobId)
  });

  const intakeForm = useForm<IntakeFormValues>({
    defaultValues: toFormValues(null)
  });

  useEffect(() => {
    if (!jobQuery.data) {
      return;
    }

    intakeForm.reset(toFormValues(jobQuery.data.files.intake));
    setOutlineDraft(jobQuery.data.files.approvedOutline ?? jobQuery.data.files.outline ?? jobQuery.data.files.handoffs["outline"] ?? "");
  }, [jobQuery.data, intakeForm]);

  const saveIntakeMutation = useMutation({
    mutationFn: (values: IntakeFormValues) => api.saveIntake(jobId, { intake: toIntakePayload(values) }),
    onMutate: () => setActionMessage("Saving intake..."),
    onSuccess: async () => {
      setActionMessage("Intake saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const runStepMutation = useMutation({
    mutationFn: (stepName: RunnableStep) => api.runStep(jobId, stepName),
    onMutate: (stepName) => setActionMessage(`Starting ${workflowStepMeta[stepName].label.toLowerCase()}...`),
    onSuccess: async (result) => {
      setActionMessage(result.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const extractCompetitorsMutation = useMutation({
    mutationFn: () => api.extractCompetitors(jobId),
    onMutate: () => setActionMessage("Extracting competitor pages..."),
    onSuccess: async (result) => {
      setActionMessage(`Extracted ${result.competitorResearch.competitors.length} competitor pages.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const approveOutlineMutation = useMutation({
    mutationFn: () => api.approveOutline(jobId, outlineDraft),
    onMutate: () => setActionMessage("Saving approved outline..."),
    onSuccess: async (result) => {
      setActionMessage(result.message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const exportArticleMutation = useMutation({
    mutationFn: (format: ExportFormat) => api.exportArticle(jobId, format),
    onMutate: (format) => setActionMessage(`Exporting ${exportLabels[format]}...`),
    onSuccess: async (result) => {
      setActionMessage(`${result.message} ${result.exportPath}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const exportAllMutation = useMutation({
    mutationFn: async () => {
      const formats: ExportFormat[] = ["markdown", "html", "docx"];
      const results = [];
      for (const format of formats) {
        results.push(await api.exportArticle(jobId, format));
      }
      return results;
    },
    onMutate: () => setActionMessage("Creating all exports..."),
    onSuccess: async () => {
      setActionMessage("Markdown, HTML, and DOCX exports created.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const job = jobQuery.data?.job;
  const files = jobQuery.data?.files;
  const steps = jobQuery.data?.steps ?? [];
  const currentStep = getCurrentStep(steps);
  const completedSteps = workflowStepOrder.filter((stepName) => getStepRecord(steps, stepName)?.status === "completed").length;
  const competitorEntries = useMemo(() => getCompetitorEntries(jobQuery.data), [jobQuery.data]);
  const artifacts = artifactsQuery.data ?? [];
  const readyArtifacts = artifacts.filter((artifact) => artifact.exists);
  const topUrlCount = splitUrlInput(intakeForm.watch("topRankingUrls")).length;
  const runningSteps = steps.filter((step) => step.status === "running");
  const activeStepLabel = runningSteps[0] ? workflowStepMeta[runningSteps[0].stepName].label : null;
  const activeOperation =
    activeStepLabel ??
    (runStepMutation.isPending && runStepMutation.variables ? workflowStepMeta[runStepMutation.variables].label : null) ??
    (extractCompetitorsMutation.isPending ? "Competitor extraction" : null) ??
    (saveIntakeMutation.isPending ? "Saving intake" : null) ??
    (approveOutlineMutation.isPending ? "Outline approval" : null) ??
    (exportAllMutation.isPending ? "All exports" : null) ??
    (exportArticleMutation.isPending ? "Export" : null);
  const isBusy = Boolean(activeOperation);
  const isStepBusy = (stepName: RunnableStep) =>
    getStepRecord(steps, stepName)?.status === "running" || (runStepMutation.isPending && runStepMutation.variables === stepName);
  const isExportBusy = exportArticleMutation.isPending || exportAllMutation.isPending;
  const hasDraft = Boolean(files?.draft);
  const hasFinalOptimized = Boolean(files?.finalOptimized);
  const exportArtifacts = artifacts.filter((artifact) => artifact.category === "export");
  const allExportsReady =
    exportArtifacts.length > 0 && exportArtifacts.every((artifact) => artifact.exists);
  const canRunFinalOptimization = hasDraft && !isStepBusy("final-optimize");
  const canExport = hasFinalOptimized && !isExportBusy;
  const currentStepActionLabel =
    currentStep === "semantic-map"
      ? "Generate semantic map"
      : currentStep === "outline"
        ? "Generate outline"
        : currentStep === "approve-outline"
          ? "Save approved outline"
          : currentStep === "draft"
            ? "Generate draft"
            : currentStep === "final-optimize"
              ? "Run final optimization"
              : hasFinalOptimized && !allExportsReady
                ? "Create all exports"
                : null;
  const runCurrentStepAction = () => {
    if (!currentStep) {
      if (hasFinalOptimized && !allExportsReady) {
        exportAllMutation.mutate();
      }
      return;
    }

    if (currentStep === "approve-outline") {
      approveOutlineMutation.mutate();
      return;
    }

    runStepMutation.mutate(currentStep);
  };
  const currentStepActionDisabled =
    !currentStepActionLabel ||
    Boolean(currentStep && currentStep !== "approve-outline" && isStepBusy(currentStep)) ||
    Boolean(currentStep === "final-optimize" && !hasDraft) ||
    Boolean(currentStep === "approve-outline" && (approveOutlineMutation.isPending || getStepRecord(steps, "approve-outline")?.status === "running")) ||
    Boolean(!currentStep && (!hasFinalOptimized || allExportsReady || isExportBusy));
  const phaseStatus = useMemo(
    () => [
      {
        ...workflowPhases[0],
        status: files?.intake?.title ? "completed" : "idle"
      },
      {
        ...workflowPhases[1],
        status:
          getStepRecord(steps, "semantic-map")?.status === "completed" || getStepRecord(steps, "outline")?.status === "completed"
            ? "completed"
            : getStepRecord(steps, "semantic-map")?.status === "running"
              ? "running"
              : "idle"
      },
      {
        ...workflowPhases[2],
        status: getStepRecord(steps, "approve-outline")?.status ?? "idle"
      },
      {
        ...workflowPhases[3],
        status:
          getStepRecord(steps, "final-optimize")?.status === "completed"
            ? "completed"
            : getStepRecord(steps, "draft")?.status === "running" || getStepRecord(steps, "final-optimize")?.status === "running"
              ? "running"
              : getStepRecord(steps, "draft")?.status === "completed"
                ? "completed"
                : "idle"
      }
    ],
    [files?.intake?.title, steps]
  );

  useEffect(() => {
    if (!isBusy || runningSteps.length > 0) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void jobQuery.refetch();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [isBusy, jobQuery.refetch, runningSteps.length]);

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-8 px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <Link to="/" className="text-sm font-medium text-emerald-800 hover:text-emerald-950">
            Back to jobs
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900">{job?.title ?? "Loading article..."}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {job ? <StatusPill label={job.status} /> : null}
            <span className="text-sm text-stone-500">Job ID: {jobId}</span>
          </div>
        </div>

        {actionMessage ? (
          <p className={`rounded-full px-4 py-2 text-sm ${isBusy ? "bg-sky-100 text-sky-900" : "bg-emerald-100 text-emerald-900"}`}>
            {actionMessage}
          </p>
        ) : null}
      </header>

      <Surface className="gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Workflow progress</p>
            <h2 className="text-lg font-semibold text-stone-900">
              {completedSteps} of {workflowStepOrder.length} generation steps completed
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {phaseStatus.map((phase) => (
              <div key={phase.key} className="flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-2">
                <span className="text-xs font-medium text-stone-600">{phase.title}</span>
                <StatusPill label={phase.status} compact />
              </div>
            ))}
            {currentStepActionLabel ? (
              <button
                type="button"
                disabled={currentStepActionDisabled}
                onClick={runCurrentStepAction}
                className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBusy ? "Working..." : currentStepActionLabel}
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-sm leading-6 text-stone-600">
          This workspace keeps prompt snapshots, outputs, and fallback handoff files together so the article can move phase by phase without leaving the local job folder.
        </p>
        {activeOperation ? (
          <div className="grid gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-sky-900">{activeOperation} is running</p>
              <StatusPill label="running" compact />
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sky-100">
              <div className="h-full w-2/3 rounded-full bg-sky-500 animate-pulse" />
            </div>
          </div>
        ) : null}
      </Surface>

      <div className="workspace-grid">
        <div className="grid gap-8">
          <Surface>
            <SurfaceHeader
              eyebrow="Phase 1"
              title="Article intake"
              description="Add the title, target keyword, and top-ranking pages. Codex infers the rest from the SERP extraction and the article goal."
            />

            <form
              className="grid gap-5"
              onSubmit={intakeForm.handleSubmit((values) => {
                saveIntakeMutation.mutate(values);
              })}
            >
              <FieldShell label="Article title / H1">
                <input {...intakeForm.register("title")} className={inputClassName()} />
              </FieldShell>

              <FieldShell label="Target keyword">
                <input {...intakeForm.register("targetKeyword")} className={inputClassName()} />
              </FieldShell>

              <FieldShell label="Top-ranking URLs" hint="Paste one per line, or paste a space-separated SERP list.">
                <textarea {...intakeForm.register("topRankingUrls")} className={`${inputClassName()} min-h-28 resize-y`} />
              </FieldShell>

              <div className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                <div className="grid gap-1">
                  <h3 className="text-sm font-semibold text-stone-900">Next action</h3>
                  <p className="text-sm leading-6 text-stone-600">
                    Save the brief, then generate the semantic map. Audience, intent, entities, attributes, and content angles are inferred automatically.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={saveIntakeMutation.isPending}
                    className="rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveIntakeMutation.isPending ? "Saving..." : "Save intake"}
                  </button>
                  <button
                    type="button"
                    disabled={saveIntakeMutation.isPending || runStepMutation.isPending}
                    onClick={intakeForm.handleSubmit(async (values) => {
                      await saveIntakeMutation.mutateAsync(values);
                      setActionMessage("Intake saved. Starting semantic map...");
                      await runStepMutation.mutateAsync("semantic-map");
                    })}
                    className="rounded-xl border border-emerald-700 px-4 py-2.5 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveIntakeMutation.isPending || runStepMutation.isPending ? "Working..." : "Save and generate semantic map"}
                  </button>
                </div>
              </div>
            </form>
          </Surface>

          <Surface>
            <SurfaceHeader
              eyebrow="Research"
              title="Competitor coverage"
              description={
                competitorEntries.length
                  ? "Extraction results are available from the API and can be reviewed here alongside the intake notes."
                  : topUrlCount
                    ? `${topUrlCount} competitor URLs are in the brief. Run extraction to pull local summaries from those pages.`
                    : "Add top-ranking URLs in the intake to prepare this area for competitor extraction results."
              }
              aside={
                topUrlCount ? (
                  <button
                    type="button"
                    disabled={extractCompetitorsMutation.isPending}
                    onClick={() => extractCompetitorsMutation.mutate()}
                    className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {extractCompetitorsMutation.isPending ? "Extracting..." : "Extract competitors"}
                  </button>
                ) : null
              }
            />

            {competitorEntries.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {competitorEntries.map((entry, index) => (
                  <section key={`${entry.title}-${index}`} className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <h3 className="text-sm font-semibold text-stone-900">{entry.title}</h3>
                        {entry.extractionSource ? (
                          <p className="text-xs font-medium uppercase tracking-[0.12em] text-stone-500">
                            Source: {entry.extractionSource.replaceAll("-", " ")}
                          </p>
                        ) : null}
                        {entry.url ? (
                          <a href={entry.url} target="_blank" rel="noreferrer" className="break-all text-xs text-emerald-800 hover:text-emerald-950">
                            {entry.url}
                          </a>
                        ) : null}
                      </div>
                      <StatusPill label={entry.status} compact />
                    </div>
                    {entry.metaDescription ? <p className="text-sm leading-6 text-stone-600">{entry.metaDescription}</p> : null}
                    {entry.excerpt ? (
                      <div className="rounded-xl bg-white px-3 py-3">
                        <p className="line-clamp-6 text-sm leading-6 text-stone-600">{entry.excerpt}</p>
                      </div>
                    ) : null}
                    {entry.errorMessage ? (
                      <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">{entry.errorMessage}</p>
                    ) : null}
                    {entry.highlights.length ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Extracted headings</p>
                        <ul className="grid gap-2 text-sm leading-6 text-stone-600">
                          {entry.highlights.map((highlight) => (
                            <li key={highlight} className="rounded-xl bg-white px-3 py-2">
                              {highlight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/70 px-4 py-5 text-sm leading-6 text-stone-500">
                No structured extraction results yet. Save the intake, add top-ranking URLs, then run extraction from this panel.
              </div>
            )}
          </Surface>

          <Surface>
            <SurfaceHeader
              eyebrow="Outputs"
              title="Workflow outputs"
              description="Review each generated result in sequence. The outline editor stays writable because that is the main approval gate before drafting."
            />

            <div className="grid gap-6">
              <section className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-600">Semantic map</h3>
                  <StatusPill label={getStepRecord(steps, "semantic-map")?.status ?? "idle"} />
                </div>
                <ReadOnlyArea value={getStepContent(jobQuery.data, "semantic-map")} placeholder={workflowStepMeta["semantic-map"].emptyState} />
              </section>

              <section className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-600">Outline</h3>
                  <StatusPill label={getStepRecord(steps, "outline")?.status ?? "idle"} />
                </div>
                <textarea
                  value={outlineDraft}
                  onChange={(event) => setOutlineDraft(event.target.value)}
                  className={`${inputClassName()} min-h-72 resize-y bg-stone-50 font-mono text-xs leading-6`}
                  placeholder={workflowStepMeta.outline.emptyState}
                />
              </section>

              <section className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-600">Draft</h3>
                  <StatusPill label={getStepRecord(steps, "draft")?.status ?? "idle"} />
                </div>
                <ReadOnlyArea value={getStepContent(jobQuery.data, "draft")} placeholder={workflowStepMeta.draft.emptyState} />
              </section>

              <section className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-stone-600">Final optimized article</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={getStepRecord(steps, "final-optimize")?.status ?? "idle"} />
                    <button
                      type="button"
                      disabled={!canRunFinalOptimization}
                      onClick={() => runStepMutation.mutate("final-optimize")}
                      className="rounded-xl bg-emerald-800 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isStepBusy("final-optimize") ? "Optimizing..." : hasFinalOptimized ? "Re-run optimization" : "Run final optimization"}
                    </button>
                    <button
                      type="button"
                      disabled={!canExport}
                      onClick={() => exportAllMutation.mutate()}
                      className="rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {exportAllMutation.isPending ? "Exporting..." : "Export all"}
                    </button>
                    <button
                      type="button"
                      disabled={!canExport}
                      onClick={() => exportArticleMutation.mutate("markdown")}
                      className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {exportArticleMutation.isPending ? "Exporting..." : "Export MD"}
                    </button>
                    <button
                      type="button"
                      disabled={!canExport}
                      onClick={() => exportArticleMutation.mutate("html")}
                      className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {exportArticleMutation.isPending ? "Exporting..." : "Export HTML"}
                    </button>
                    <button
                      type="button"
                      disabled={!canExport}
                      onClick={() => exportArticleMutation.mutate("docx")}
                      className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {exportArticleMutation.isPending ? "Exporting..." : "Export DOCX"}
                    </button>
                  </div>
                </div>
                <ReadOnlyArea value={getStepContent(jobQuery.data, "final-optimize")} placeholder={workflowStepMeta["final-optimize"].emptyState} />
                {readyArtifacts.some((artifact) => artifact.category === "export") ? (
                  <div className="flex flex-wrap gap-2">
                    {readyArtifacts
                      .filter((artifact) => artifact.category === "export")
                      .map((artifact) => (
                        <div key={artifact.type} className="flex flex-wrap gap-2">
                          <a
                            href={artifact.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-200"
                          >
                            Open {artifact.label}
                          </a>
                          <a
                            href={artifact.downloadUrl}
                            className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white"
                          >
                            Download {artifact.label}
                          </a>
                        </div>
                      ))}
                  </div>
                ) : null}
              </section>
            </div>
          </Surface>
        </div>

        <aside className="workspace-sidebar grid gap-6">
          <Surface>
            <SurfaceHeader
              eyebrow="Workflow panel"
              title="Current path"
              description={
                currentStep
                  ? `The next recommended step is ${workflowStepMeta[currentStep].label.toLowerCase()}.`
                  : "All workflow steps are complete. The final article is ready to review and export."
              }
            />

            <div className="grid gap-3">
              {workflowStepOrder.map((stepName, index) => {
                const record = getStepRecord(steps, stepName);
                const detail =
                  record?.errorMessage ??
                  (record?.completedAt
                    ? `Last completed ${formatDateTime(record.completedAt)}`
                    : record?.startedAt
                      ? `Started ${formatDateTime(record.startedAt)}`
                      : workflowStepMeta[stepName].emptyState);

                return (
                  <WorkflowStepCard
                    key={stepName}
                    index={index + 1}
                    title={workflowStepMeta[stepName].label}
                    description={workflowStepMeta[stepName].description}
                    status={record?.status ?? "idle"}
                    detail={detail ?? undefined}
                    isCurrent={currentStep === stepName}
                  >
                    {stepName === "semantic-map" ? (
                      <button
                        type="button"
                        disabled={isStepBusy("semantic-map")}
                        onClick={() => runStepMutation.mutate("semantic-map")}
                        className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isStepBusy("semantic-map") ? "Running..." : "Generate"}
                      </button>
                    ) : null}
                    {stepName === "outline" ? (
                      <button
                        type="button"
                        disabled={isStepBusy("outline")}
                        onClick={() => runStepMutation.mutate("outline")}
                        className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isStepBusy("outline") ? "Running..." : "Generate"}
                      </button>
                    ) : null}
                    {stepName === "approve-outline" ? (
                      <button
                        type="button"
                        disabled={approveOutlineMutation.isPending || getStepRecord(steps, "approve-outline")?.status === "running"}
                        onClick={() => approveOutlineMutation.mutate()}
                        className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {approveOutlineMutation.isPending ? "Saving..." : "Save approved outline"}
                      </button>
                    ) : null}
                    {stepName === "draft" ? (
                      <button
                        type="button"
                        disabled={isStepBusy("draft")}
                        onClick={() => runStepMutation.mutate("draft")}
                        className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isStepBusy("draft") ? "Running..." : "Generate"}
                      </button>
                    ) : null}
                    {stepName === "final-optimize" ? (
                      <button
                        type="button"
                        disabled={!canRunFinalOptimization}
                        onClick={() => runStepMutation.mutate("final-optimize")}
                        className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isStepBusy("final-optimize") ? "Running..." : "Run optimization"}
                      </button>
                    ) : null}
                  </WorkflowStepCard>
                );
              })}
            </div>
          </Surface>

          <Surface>
            <SurfaceHeader
              eyebrow="Local record"
              title="Saved artifacts"
              description="The article folder remains the source of truth for prompts, generated Markdown, fallback handoff files, and exports."
            />
            <div className="grid gap-3 text-sm leading-6 text-stone-600">
              {artifactsQuery.isLoading ? (
                <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3">Loading saved files...</div>
              ) : null}
              {artifacts.map((artifact: JobArtifact) => {
                const exportFormat = exportFormatByArtifactType[artifact.type];
                const isFinalArtifact = artifact.type === "final-optimized";
                const action = isFinalArtifact ? (
                  <button
                    type="button"
                    disabled={!canRunFinalOptimization}
                    onClick={() => runStepMutation.mutate("final-optimize")}
                    className="rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isStepBusy("final-optimize") ? "Optimizing..." : artifact.exists ? "Re-run" : "Generate"}
                  </button>
                ) : exportFormat ? (
                  <button
                    type="button"
                    disabled={!canExport}
                    onClick={() => exportArticleMutation.mutate(exportFormat)}
                    className="rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {exportArticleMutation.isPending && exportArticleMutation.variables === exportFormat
                      ? "Exporting..."
                      : artifact.exists
                        ? "Re-export"
                        : "Create"}
                  </button>
                ) : null;

                return (
                  <div key={artifact.type} className="grid gap-2 rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span>{artifact.label}</span>
                      <StatusPill label={artifact.exists ? "completed" : "idle"} compact />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                      <span>{artifact.category}</span>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {artifact.exists ? (
                          <>
                            <a href={artifact.url} target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 hover:text-emerald-950">
                              Open {formatBytes(artifact.sizeBytes)}
                            </a>
                            <span aria-hidden="true">/</span>
                            <a href={artifact.downloadUrl} className="font-semibold text-emerald-800 hover:text-emerald-950">
                              Download
                            </a>
                          </>
                        ) : (
                          <span>Not created yet</span>
                        )}
                        {action}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Surface>
        </aside>
      </div>
    </main>
  );
}
