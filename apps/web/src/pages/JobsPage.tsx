import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "../components/Button";
import { Surface, SurfaceHeader } from "../components/Surface";
import { StatusPill } from "../components/StatusPill";
import { FieldShell, inputClassName } from "../components/TextField";
import { api } from "../lib/api";
import { workflowPhases } from "../lib/workflow";

type CreateJobForm = {
  title: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function JobsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createError, setCreateError] = useState<string | null>(null);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings
  });
  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: api.listJobs
  });
  const form = useForm<CreateJobForm>({
    defaultValues: {
      title: ""
    }
  });

  const createMutation = useMutation({
    mutationFn: api.createJob,
    onMutate: () => setCreateError(null),
    onSuccess: async (job) => {
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate(`/jobs/${job.id}`);
    },
    onError: (error) => setCreateError(getErrorMessage(error))
  });

  const settings = settingsQuery.data;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-5 py-12 lg:px-8">
      <section className="grid items-start gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">Semantic SEO Workflow</span>
          <h1 className="max-w-2xl font-display text-[2.6rem] leading-[1.08] text-ink-900">
            Move each article through a clear workflow, not a pile of prompts.
          </h1>
          <p className="max-w-xl text-base leading-7 text-ink-500">
            Every job keeps its brief, prompt snapshots, draft outputs, quality audits, and fallback handoffs together in
            one workspace on disk — from semantic map to a publish-ready article.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {["Local-first", "Human approval gate", "Deterministic quality audits"].map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-hairline bg-white/60 px-3 py-1 text-xs font-medium text-ink-600"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <Surface className="gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-ink-900">Runtime</h2>
            {settings ? (
              <StatusPill
                label={
                  settings.codexAvailable && settings.codexAuthenticated
                    ? settings.generationProvider ?? "claude"
                    : "manual-input-required"
                }
              />
            ) : settingsQuery.isError ? (
              <StatusPill label="error" />
            ) : null}
          </div>
          <dl className="grid gap-3 text-sm">
            {settingsQuery.isError ? (
              <p className="rounded-[var(--radius-md)] bg-rose-50 px-3 py-2 text-rose-800">
                Could not load runtime settings. The API may be offline.
              </p>
            ) : null}
            <div className="grid gap-1">
              <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-400">Workspace</dt>
              <dd className="truncate font-mono text-xs text-ink-700" title={settings?.workspaceRoot}>
                {settings?.workspaceRoot ?? (settingsQuery.isError ? "unavailable" : "Loading…")}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-400">
                {(settings?.generationProvider === "codex" ? "Codex" : "Claude") + " generation"}
              </dt>
              <dd className="text-ink-700">
                {settings
                  ? settings.codexAvailable && settings.codexAuthenticated
                    ? "Connected and ready"
                    : "Not authenticated — manual handoff mode"
                  : settingsQuery.isError
                  ? "Unavailable"
                  : "Checking…"}
              </dd>
            </div>
          </dl>
        </Surface>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {workflowPhases.map((phase, index) => (
          <Surface key={phase.key} className="gap-3 p-5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-display text-lg text-brand-800">
              {index + 1}
            </span>
            <h2 className="text-base font-semibold text-ink-900">{phase.title}</h2>
            <p className="text-sm leading-6 text-ink-600">{phase.description}</p>
          </Surface>
        ))}
      </section>

      <section className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
        <Surface>
          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => {
              createMutation.mutate({ title: values.title });
            })}
          >
            <SurfaceHeader
              eyebrow="New job"
              title="Start a new article"
              description="Create the workspace first, then move through the brief, analysis, outline approval, and drafting phases."
            />

            <FieldShell label="Article title / H1">
              <input
                {...form.register("title", { required: true })}
                className={inputClassName()}
                placeholder="Example: What is semantic SEO and how does it improve topical coverage?"
              />
            </FieldShell>

            <Button type="submit" loading={createMutation.isPending} className="justify-self-start">
              {createMutation.isPending ? "Creating…" : "Create job"}
            </Button>

            {createError ? (
              <p role="alert" className="rounded-[var(--radius-md)] bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
                {createError}
              </p>
            ) : null}
          </form>
        </Surface>

        <section className="grid gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl text-ink-900">Recent jobs</h2>
            <span className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-medium text-ink-500">
              {jobsQuery.data?.length ?? 0} total
            </span>
          </div>

          <div className="grid gap-3">
            {jobsQuery.data?.map((job) => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="group grid gap-3 rounded-[var(--radius-card)] border border-hairline bg-white/70 p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-300 hover:bg-white hover:shadow-lifted"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <h3 className="text-base font-semibold text-ink-900 transition-colors group-hover:text-brand-700">
                      {job.title}
                    </h3>
                    <p className="font-mono text-xs text-ink-500">{job.slug}</p>
                  </div>
                  <StatusPill label={job.status} compact />
                </div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
                  Updated {new Date(job.updatedAt).toLocaleString()}
                </p>
              </Link>
            ))}

            {jobsQuery.isLoading ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 px-4 py-10 text-center text-sm text-ink-500">
                Loading jobs…
              </div>
            ) : jobsQuery.isError ? (
              <div className="grid gap-3 rounded-[var(--radius-card)] border border-rose-200 bg-rose-50/70 px-4 py-6 text-center">
                <p className="text-sm text-rose-800">Could not load jobs. {getErrorMessage(jobsQuery.error)}</p>
                <Button variant="danger" size="sm" onClick={() => jobsQuery.refetch()} className="mx-auto">
                  Retry
                </Button>
              </div>
            ) : !jobsQuery.data?.length ? (
              <div className="grid justify-items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-white/40 px-4 py-12 text-center">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                  </svg>
                </span>
                <p className="max-w-xs text-sm leading-6 text-ink-500">
                  No article jobs yet. Create your first one from the panel on the left to spin up a workspace.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
