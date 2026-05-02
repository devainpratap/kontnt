import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";

import { Surface, SurfaceHeader } from "../components/Surface";
import { StatusPill } from "../components/StatusPill";
import { FieldShell, inputClassName } from "../components/TextField";
import { api } from "../lib/api";
import { workflowPhases } from "../lib/workflow";

type CreateJobForm = {
  title: string;
};

export function JobsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    onSuccess: async (job) => {
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate(`/jobs/${job.id}`);
    }
  });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-5 py-10 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-4">
          <span className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-800">Semantic SEO Workflow</span>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-stone-900">
            Move each article through a clear local workflow instead of juggling prompts by hand.
          </h1>
          <p className="max-w-2xl text-base leading-7 text-stone-600">
            Every job keeps the intake, prompt snapshots, draft outputs, and fallback handoff prompts together in one workspace on disk.
          </p>
        </div>

        <Surface className="gap-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-stone-900">Runtime</h2>
            {settingsQuery.data ? (
              <StatusPill label={settingsQuery.data.generationMode === "codex" ? "codex" : "manual-input-required"} />
            ) : null}
          </div>
          <div className="grid gap-2 text-sm text-stone-600">
            <p>Workspace: {settingsQuery.data?.workspaceRoot ?? "Loading..."}</p>
            <p>
              Codex:{" "}
              {settingsQuery.data
                ? settingsQuery.data.codexAvailable
                  ? settingsQuery.data.codexAuthenticated
                    ? "available and authenticated"
                    : "available but not authenticated"
                  : "not found"
                : "checking"}
            </p>
          </div>
        </Surface>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        {workflowPhases.map((phase, index) => (
          <Surface key={phase.key} className="gap-3 p-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-900">
                {index + 1}
              </span>
              <h2 className="text-base font-semibold text-stone-900">{phase.title}</h2>
            </div>
            <p className="text-sm leading-6 text-stone-600">{phase.description}</p>
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

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-900"
            >
              {createMutation.isPending ? "Creating..." : "Create job"}
            </button>
          </form>
        </Surface>

        <section className="grid gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-stone-900">Recent jobs</h2>
            <span className="text-sm text-stone-500">{jobsQuery.data?.length ?? 0} total</span>
          </div>

          <div className="grid gap-3">
            {jobsQuery.data?.map((job) => (
              <Link
                key={job.id}
                to={`/jobs/${job.id}`}
                className="grid gap-3 rounded-2xl border border-stone-200 bg-white/82 p-4 shadow-[0_10px_30px_rgba(33,26,18,0.05)] transition hover:border-emerald-300 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <h3 className="text-base font-semibold text-stone-900">{job.title}</h3>
                    <p className="text-sm text-stone-500">{job.slug}</p>
                  </div>
                  <StatusPill label={job.status} />
                </div>
                <p className="text-xs uppercase tracking-[0.12em] text-stone-500">Updated {new Date(job.updatedAt).toLocaleString()}</p>
              </Link>
            ))}

            {!jobsQuery.data?.length ? (
              <div className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
                No article jobs yet. Create the first one from the panel on the left.
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
