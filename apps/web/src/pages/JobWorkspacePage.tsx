import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router-dom";

import type { ExportFormat, JobArtifact, JobDetail, WorkflowStep } from "@semantic-seo/shared";

import { Surface, SurfaceHeader } from "../components/Surface";
import { StatusPill } from "../components/StatusPill";
import { WorkflowStepper, type StepperItem } from "../components/WorkflowStepper";
import { AdvancedBriefFields } from "../components/AdvancedBriefFields";
import { ManualHandoffPanel } from "../components/ManualHandoffPanel";
import { AuditReports } from "../components/AuditReports";
import { FieldShell, ReadOnlyArea, inputClassName } from "../components/TextField";
import { Button, ButtonLink } from "../components/Button";
import { api } from "../lib/api";
import { splitUrlInput, toFormValues, toIntakePayload, type IntakeFormValues } from "../lib/intake";
import { resolveServerOutline, shouldSeed, type Seed } from "../lib/seeding";
import { getCurrentStep, getStepRecord, workflowStepMeta, workflowStepOrder } from "../lib/workflow";

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

  // Only real generated content belongs in the output boxes. Manual-handoff
  // prompts get their own distinct panel (see ManualHandoffPanel) so they are
  // never mistaken for finished output.
  if (stepName === "semantic-map") {
    return job.files.semanticMap ?? "";
  }

  if (stepName === "outline" || stepName === "approve-outline") {
    return job.files.approvedOutline ?? job.files.outline ?? "";
  }

  if (stepName === "draft") {
    return job.files.draft ?? "";
  }

  return job.files.finalOptimized ?? "";
}

/** The manual-handoff prompt for a step, when Codex was unavailable for it. */
function getStepHandoff(job: JobDetail | undefined, stepName: WorkflowStep): string | null {
  if (!job) {
    return null;
  }

  const record = job.steps.find((step) => step.stepName === stepName);
  const handoff = job.files.handoffs[stepName];
  if (record?.status === "manual-input-required" && handoff && handoff.trim().length > 0) {
    return handoff;
  }

  return null;
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

  // Seed editable local state (outline draft + intake form) from the server
  // ONLY when the server content genuinely changes or the job changes — never
  // on the identity-only object churn produced by every mutation → invalidate →
  // refetch cycle. Without this guard, saving intake (or any other mutation)
  // would silently clobber unsaved outline/intake edits. See lib/seeding.ts.
  const outlineSeedRef = useRef<Seed | null>(null);
  const intakeSeedRef = useRef<Seed | null>(null);

  useEffect(() => {
    if (!jobQuery.data) {
      return;
    }

    const serverOutline = resolveServerOutline(jobQuery.data.files);
    if (shouldSeed(outlineSeedRef.current, jobId, serverOutline)) {
      setOutlineDraft(serverOutline);
      outlineSeedRef.current = { jobId, signature: serverOutline };
    }

    const intakeSignature = JSON.stringify(jobQuery.data.files.intake ?? null);
    if (shouldSeed(intakeSeedRef.current, jobId, intakeSignature)) {
      intakeForm.reset(toFormValues(jobQuery.data.files.intake));
      intakeSeedRef.current = { jobId, signature: intakeSignature };
    }
  }, [jobQuery.data, jobId, intakeForm]);

  const saveIntakeMutation = useMutation({
    mutationFn: (values: IntakeFormValues) => api.saveIntake(jobId, { intake: toIntakePayload(values) }),
    onMutate: () => setActionMessage("Saving intake…"),
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

  // Fire-and-poll: the POST resolves immediately with a 202 ack. Invalidating
  // the job query flips the step to "running", which starts the 2500ms
  // refetchInterval that observes completion/failure from the DB.
  const runStepMutation = useMutation({
    mutationFn: (stepName: RunnableStep) => api.runStep(jobId, stepName),
    onMutate: (stepName) => setActionMessage(`Starting ${workflowStepMeta[stepName].label.toLowerCase()}…`),
    onSuccess: async (result) => {
      setActionMessage(
        result.status === "already-running"
          ? `${workflowStepMeta[result.stepName].label} is already running.`
          : `${workflowStepMeta[result.stepName].label} is running.`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const cancelStepMutation = useMutation({
    mutationFn: (stepName: WorkflowStep) => api.cancelStep(jobId, stepName),
    onMutate: (stepName) => setActionMessage(`Cancelling ${workflowStepMeta[stepName].label.toLowerCase()}…`),
    onSuccess: async (result, stepName) => {
      setActionMessage(
        result.cancelled
          ? `Cancelled ${workflowStepMeta[stepName].label.toLowerCase()}.`
          : "Nothing to cancel — the step may have already finished."
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts", jobId] })
      ]);
    },
    onError: (error) => setActionMessage(getErrorMessage(error))
  });

  const extractCompetitorsMutation = useMutation({
    mutationFn: () => api.extractCompetitors(jobId),
    onMutate: () => setActionMessage("Extracting competitor pages…"),
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
    onMutate: () => setActionMessage("Saving approved outline…"),
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
    onMutate: (format) => setActionMessage(`Exporting ${exportLabels[format]}…`),
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
    onMutate: () => setActionMessage("Creating all exports…"),
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
  const auditArtifacts = artifacts.filter((artifact) => artifact.category === "audit");
  const allExportsReady = exportArtifacts.length > 0 && exportArtifacts.every((artifact) => artifact.exists);
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
  useEffect(() => {
    if (!isBusy || runningSteps.length > 0) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void jobQuery.refetch();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [isBusy, jobQuery.refetch, runningSteps.length]);

  if (jobQuery.isError) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-16">
        <div className="grid gap-4 rounded-[var(--radius-card)] border border-rose-200 bg-rose-50 p-6 shadow-soft">
          <div className="grid gap-1.5">
            <Link to="/" className="text-sm font-medium text-brand-700 hover:text-brand-800">
              ← Back to jobs
            </Link>
            <h1 className="font-display text-2xl leading-tight text-ink-900">This article could not be loaded</h1>
            <p className="text-sm leading-6 text-ink-500">{getErrorMessage(jobQuery.error)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => jobQuery.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const stepAction = (stepName: WorkflowStep) => {
    if (stepName === "approve-outline") {
      return (
        <Button
          variant="secondary"
          size="sm"
          disabled={approveOutlineMutation.isPending || getStepRecord(steps, "approve-outline")?.status === "running"}
          onClick={() => approveOutlineMutation.mutate()}
        >
          {approveOutlineMutation.isPending ? "Saving…" : "Save approved outline"}
        </Button>
      );
    }

    if (stepName === "final-optimize") {
      return (
        <Button variant="secondary" size="sm" disabled={!canRunFinalOptimization} onClick={() => runStepMutation.mutate("final-optimize")}>
          {isStepBusy("final-optimize") ? "Running…" : "Run optimization"}
        </Button>
      );
    }

    const runnable = stepName as RunnableStep;
    return (
      <Button variant="secondary" size="sm" disabled={isStepBusy(runnable)} onClick={() => runStepMutation.mutate(runnable)}>
        {isStepBusy(runnable) ? "Running…" : "Generate"}
      </Button>
    );
  };

  const stepperItems: StepperItem[] = workflowStepOrder.map((stepName) => {
    const record = getStepRecord(steps, stepName);
    const status = record?.status ?? "idle";
    const isCurrent = currentStep === stepName;
    const detail =
      record?.errorMessage ??
      (record?.completedAt
        ? `Completed ${formatDateTime(record.completedAt)}`
        : record?.startedAt
          ? `Started ${formatDateTime(record.startedAt)}`
          : undefined);

    return {
      key: stepName,
      label: workflowStepMeta[stepName].label,
      status,
      isCurrent,
      detail: detail ?? undefined,
      action: isCurrent || status === "failed" || status === "manual-input-required" ? stepAction(stepName) : undefined
    };
  });

  const exportStepCurrent = !currentStep && hasFinalOptimized && !allExportsReady;
  stepperItems.push({
    key: "export",
    label: "Export article",
    status: allExportsReady ? "completed" : "idle",
    isCurrent: exportStepCurrent,
    detail: allExportsReady ? "All formats exported" : hasFinalOptimized ? "Ready to export" : "After final optimization",
    action: exportStepCurrent ? (
      <Button variant="secondary" size="sm" disabled={!canExport} onClick={() => exportAllMutation.mutate()}>
        {exportAllMutation.isPending ? "Exporting…" : "Export all"}
      </Button>
    ) : undefined
  });

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-5 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <Link to="/" className="text-sm font-medium text-brand-700 hover:text-brand-800">
            ← Back to jobs
          </Link>
          <h1 className="font-display text-3xl leading-tight text-ink-900">{job?.title ?? "Loading article…"}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {job ? <StatusPill label={job.status} /> : null}
            <span className="font-mono text-xs text-ink-400">Job ID: {jobId}</span>
          </div>
        </div>

        <p
          role="status"
          aria-live="polite"
          className={
            actionMessage
              ? `max-w-md rounded-full px-4 py-2 text-sm ring-1 ring-inset ${
                  isBusy ? "bg-sky-50 text-sky-700 ring-sky-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                }`
              : "sr-only"
          }
        >
          {actionMessage}
        </p>
      </header>

      <div className="workspace-grid">
        {/* Left rail — the pipeline, always visible */}
        <aside className="workspace-rail grid gap-4">
          <Surface className="gap-5">
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">Workflow</p>
                <h2 className="font-display text-lg text-ink-900">
                  {completedSteps} of {workflowStepOrder.length} steps done
                </h2>
              </div>
              {isBusy ? <StatusPill label="running" compact /> : null}
            </div>

            <WorkflowStepper items={stepperItems} />

            {currentStepActionLabel ? (
              <Button variant="primary" disabled={currentStepActionDisabled} onClick={runCurrentStepAction} className="w-full">
                {isBusy ? "Working…" : currentStepActionLabel}
              </Button>
            ) : null}

            {activeOperation && runningSteps[0] ? (
              <div className="grid gap-2 rounded-[var(--radius-md)] border border-sky-200 bg-sky-50 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-sky-700">{activeOperation} running</p>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={cancelStepMutation.isPending}
                    onClick={() => cancelStepMutation.mutate(runningSteps[0].stepName)}
                  >
                    {cancelStepMutation.isPending ? "Cancelling…" : "Cancel"}
                  </Button>
                </div>
                <div className="progress-track h-1.5" />
              </div>
            ) : null}
          </Surface>
        </aside>

        {/* Main column */}
        <div className="grid min-w-0 gap-6">
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

              <AdvancedBriefFields register={intakeForm.register} />

              <div className="grid gap-3 rounded-[var(--radius-md)] border border-hairline bg-ink-50 p-4">
                <div className="grid gap-1">
                  <h3 className="text-sm font-semibold text-ink-900">Next action</h3>
                  <p className="text-sm leading-6 text-ink-500">
                    Save the brief, then generate the semantic map. Audience, intent, entities, attributes, and content
                    angles are inferred automatically.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" loading={saveIntakeMutation.isPending}>
                    {saveIntakeMutation.isPending ? "Saving…" : "Save intake"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saveIntakeMutation.isPending || runStepMutation.isPending}
                    onClick={intakeForm.handleSubmit(async (values) => {
                      await saveIntakeMutation.mutateAsync(values);
                      setActionMessage("Intake saved. Starting semantic map…");
                      await runStepMutation.mutateAsync("semantic-map");
                    })}
                  >
                    {saveIntakeMutation.isPending || runStepMutation.isPending ? "Working…" : "Save and generate semantic map"}
                  </Button>
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
                  <Button
                    variant="ghost"
                    disabled={extractCompetitorsMutation.isPending}
                    onClick={() => extractCompetitorsMutation.mutate()}
                  >
                    {extractCompetitorsMutation.isPending ? "Extracting…" : "Extract competitors"}
                  </Button>
                ) : null
              }
            />

            {competitorEntries.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {competitorEntries.map((entry, index) => (
                  <section key={`${entry.title}-${index}`} className="grid gap-3 rounded-[var(--radius-md)] border border-hairline bg-ink-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <h3 className="text-sm font-semibold text-ink-900">{entry.title}</h3>
                        {entry.extractionSource ? (
                          <p className="text-xs font-medium uppercase tracking-[0.1em] text-ink-400">
                            Source: {entry.extractionSource.replaceAll("-", " ")}
                          </p>
                        ) : null}
                        {entry.url ? (
                          <a href={entry.url} target="_blank" rel="noreferrer" className="break-all text-xs text-brand-700 hover:text-brand-800">
                            {entry.url}
                          </a>
                        ) : null}
                      </div>
                      <StatusPill label={entry.status} compact />
                    </div>
                    {entry.metaDescription ? <p className="text-sm leading-6 text-ink-500">{entry.metaDescription}</p> : null}
                    {entry.excerpt ? (
                      <div className="rounded-[var(--radius-md)] bg-white px-3 py-3 ring-1 ring-inset ring-hairline">
                        <p className="line-clamp-6 text-sm leading-6 text-ink-500">{entry.excerpt}</p>
                      </div>
                    ) : null}
                    {entry.errorMessage ? (
                      <p className="rounded-[var(--radius-md)] bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700">{entry.errorMessage}</p>
                    ) : null}
                    {entry.highlights.length ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-400">Extracted headings</p>
                        <ul className="grid gap-2 text-sm leading-6 text-ink-500">
                          {entry.highlights.map((highlight) => (
                            <li key={highlight} className="rounded-[var(--radius-md)] bg-white px-3 py-2 ring-1 ring-inset ring-hairline">
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
              <div className="rounded-[var(--radius-md)] border border-dashed border-ink-200 bg-ink-50 px-4 py-5 text-sm leading-6 text-ink-500">
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
              <section id="output-semantic-map" className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">Semantic map</h3>
                  <StatusPill label={getStepRecord(steps, "semantic-map")?.status ?? "idle"} compact />
                </div>
                <ReadOnlyArea value={getStepContent(jobQuery.data, "semantic-map")} placeholder={workflowStepMeta["semantic-map"].emptyState} />
                {getStepHandoff(jobQuery.data, "semantic-map") ? (
                  <ManualHandoffPanel stepLabel={workflowStepMeta["semantic-map"].label} handoff={getStepHandoff(jobQuery.data, "semantic-map")!} />
                ) : null}
              </section>

              <section id="output-outline" className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">Outline</h3>
                  <StatusPill label={getStepRecord(steps, "outline")?.status ?? "idle"} compact />
                </div>
                <textarea
                  value={outlineDraft}
                  onChange={(event) => setOutlineDraft(event.target.value)}
                  className={`${inputClassName()} min-h-72 resize-y bg-ink-50 font-mono text-xs leading-6`}
                  placeholder={workflowStepMeta.outline.emptyState}
                />
                {getStepHandoff(jobQuery.data, "outline") ? (
                  <ManualHandoffPanel stepLabel={workflowStepMeta.outline.label} handoff={getStepHandoff(jobQuery.data, "outline")!} />
                ) : null}
              </section>

              <section id="output-draft" className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">Draft</h3>
                  <StatusPill label={getStepRecord(steps, "draft")?.status ?? "idle"} compact />
                </div>
                <ReadOnlyArea value={getStepContent(jobQuery.data, "draft")} placeholder={workflowStepMeta.draft.emptyState} />
                {getStepHandoff(jobQuery.data, "draft") ? (
                  <ManualHandoffPanel stepLabel={workflowStepMeta.draft.label} handoff={getStepHandoff(jobQuery.data, "draft")!} />
                ) : null}
              </section>

              <section id="output-final-optimize" className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">Final optimized article</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={getStepRecord(steps, "final-optimize")?.status ?? "idle"} compact />
                    <Button variant="primary" size="sm" disabled={!canRunFinalOptimization} onClick={() => runStepMutation.mutate("final-optimize")}>
                      {isStepBusy("final-optimize") ? "Optimizing…" : hasFinalOptimized ? "Re-run optimization" : "Run final optimization"}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={!canExport} onClick={() => exportAllMutation.mutate()}>
                      {exportAllMutation.isPending ? "Exporting…" : "Export all"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!canExport} onClick={() => exportArticleMutation.mutate("markdown")}>
                      {exportArticleMutation.isPending ? "Exporting…" : "MD"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!canExport} onClick={() => exportArticleMutation.mutate("html")}>
                      {exportArticleMutation.isPending ? "Exporting…" : "HTML"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!canExport} onClick={() => exportArticleMutation.mutate("docx")}>
                      {exportArticleMutation.isPending ? "Exporting…" : "DOCX"}
                    </Button>
                  </div>
                </div>
                <ReadOnlyArea value={getStepContent(jobQuery.data, "final-optimize")} placeholder={workflowStepMeta["final-optimize"].emptyState} />
                {getStepHandoff(jobQuery.data, "final-optimize") ? (
                  <ManualHandoffPanel stepLabel={workflowStepMeta["final-optimize"].label} handoff={getStepHandoff(jobQuery.data, "final-optimize")!} />
                ) : null}
                {readyArtifacts.some((artifact) => artifact.category === "export") ? (
                  <div className="flex flex-wrap gap-2">
                    {readyArtifacts
                      .filter((artifact) => artifact.category === "export")
                      .map((artifact) => (
                        <div key={artifact.type} className="flex flex-wrap gap-2">
                          <ButtonLink variant="subtle" size="sm" href={artifact.url} target="_blank" rel="noreferrer">
                            Open {artifact.label}
                          </ButtonLink>
                          <ButtonLink variant="ghost" size="sm" href={artifact.downloadUrl}>
                            Download {artifact.label}
                          </ButtonLink>
                        </div>
                      ))}
                  </div>
                ) : null}
              </section>

              <section className="grid gap-2 border-t border-hairline pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">Audit reports</h3>
                </div>
                {artifactsQuery.isError ? (
                  <p className="rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    Could not load audit reports. {getErrorMessage(artifactsQuery.error)}
                  </p>
                ) : auditArtifacts.some((artifact) => artifact.exists) ? (
                  <AuditReports jobId={jobId} artifacts={auditArtifacts} />
                ) : (
                  <p className="rounded-[var(--radius-md)] border border-dashed border-ink-200 bg-ink-50 px-4 py-4 text-sm leading-6 text-ink-500">
                    Style and structure audits appear here once the outline, draft, and final optimization steps run. They
                    show what the quality engine flagged and repaired.
                  </p>
                )}
              </section>
            </div>
          </Surface>

          <Surface>
            <SurfaceHeader
              eyebrow="Local record"
              title="Saved artifacts"
              description="The article folder remains the source of truth for prompts, generated Markdown, fallback handoff files, and exports."
            />
            <div className="grid gap-3 text-sm leading-6 text-ink-500 md:grid-cols-2">
              {artifactsQuery.isLoading ? (
                <div className="rounded-[var(--radius-md)] border border-hairline bg-ink-50 px-4 py-3">Loading saved files…</div>
              ) : null}
              {artifactsQuery.isError ? (
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-4 py-3">
                  <span className="text-rose-700">Could not load saved files.</span>
                  <Button variant="danger" size="sm" onClick={() => artifactsQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              ) : null}
              {artifacts.map((artifact: JobArtifact) => {
                const exportFormat = exportFormatByArtifactType[artifact.type];
                const isFinalArtifact = artifact.type === "final-optimized";
                const action = isFinalArtifact ? (
                  <Button variant="secondary" size="sm" disabled={!canRunFinalOptimization} onClick={() => runStepMutation.mutate("final-optimize")}>
                    {isStepBusy("final-optimize") ? "Optimizing…" : artifact.exists ? "Re-run" : "Generate"}
                  </Button>
                ) : exportFormat ? (
                  <Button variant="secondary" size="sm" disabled={!canExport} onClick={() => exportArticleMutation.mutate(exportFormat)}>
                    {exportArticleMutation.isPending && exportArticleMutation.variables === exportFormat
                      ? "Exporting…"
                      : artifact.exists
                        ? "Re-export"
                        : "Create"}
                  </Button>
                ) : null;

                return (
                  <div key={artifact.type} className="grid gap-2 rounded-[var(--radius-md)] border border-hairline bg-ink-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-ink-800">{artifact.label}</span>
                      <StatusPill label={artifact.exists ? "completed" : "idle"} compact />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
                      <span className="uppercase tracking-[0.1em]">{artifact.category}</span>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {artifact.exists ? (
                          <>
                            <a href={artifact.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:text-brand-800">
                              Open {formatBytes(artifact.sizeBytes)}
                            </a>
                            <span aria-hidden="true">·</span>
                            <a href={artifact.downloadUrl} className="font-semibold text-brand-700 hover:text-brand-800">
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
        </div>
      </div>
    </main>
  );
}
