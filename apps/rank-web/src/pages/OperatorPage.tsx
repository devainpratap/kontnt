import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { OperatorRun } from "@rankos/shared";

import { Button } from "../components/Button";
import { StatusPill } from "../components/StatusPill";
import { Surface, SurfaceHeader } from "../components/Surface";
import { api } from "../lib/api";
import { formatRelativeTime } from "../lib/format";

const HEALTH_TONE: Record<OperatorRun["healthLevel"], "good" | "warn" | "bad"> = {
  ok: "good",
  warn: "warn",
  critical: "bad"
};

const HEALTH_LABEL: Record<OperatorRun["healthLevel"], string> = {
  ok: "All clear",
  warn: "Warnings",
  critical: "Needs you"
};

function RunJournal({ runId }: { runId: string }) {
  const detail = useQuery({ queryKey: ["operator-run", runId], queryFn: () => api.getOperatorRun(runId) });
  if (detail.isLoading) return <p className="p-4 text-[13px] text-ink-500">Loading…</p>;
  const journal = detail.data?.journal;
  if (!journal) return <p className="p-4 text-[13px] text-ink-500">No journal for this run.</p>;
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-hairline bg-ink-50/40 p-4 font-sans text-[13px] leading-6 text-ink-700">
      {journal}
    </pre>
  );
}

export function OperatorPage() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const state = useQuery({ queryKey: ["operator"], queryFn: api.getOperator });
  const runs = useQuery({ queryKey: ["operator-runs"], queryFn: api.listOperatorRuns });
  const notes = useQuery({ queryKey: ["operator-notes"], queryFn: api.getOperatorNotes });

  const runNow = useMutation({
    mutationFn: api.runOperator,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["operator"] });
      await queryClient.invalidateQueries({ queryKey: ["operator-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["operator-notes"] });
    }
  });

  const acknowledge = useMutation({
    mutationFn: (runId: string) => api.acknowledgeOperatorRun(runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operator"] })
  });

  const latest = state.data?.latest;
  const open = state.data?.openEscalations ?? [];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="font-display text-2xl text-ink-900">Operator</h1>
          <p className="text-[13px] text-ink-500">
            RankOS's operations brain. It watches the system, fixes the safe problems itself, and flags anything that
            needs you. Autonomy: <strong className="text-ink-700">{state.data?.autonomy ?? "…"}</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {latest ? <StatusPill tone={HEALTH_TONE[latest.healthLevel]}>{HEALTH_LABEL[latest.healthLevel]}</StatusPill> : null}
          <Button loading={runNow.isPending} onClick={() => runNow.mutate()}>
            Run a check now
          </Button>
        </div>
      </div>

      {/* Open escalations - the only thing that demands attention. */}
      {open.length > 0 ? (
        <Surface className="border-rose-200">
          <SurfaceHeader eyebrow="Needs you" title="Open escalations" />
          <div className="grid gap-3">
            {open.map((run) => (
              <div key={run.id} className="grid gap-2 rounded-[var(--radius-md)] border border-hairline bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-ink-400">{formatRelativeTime(run.ranAt)}</span>
                  <Button size="sm" variant="ghost" onClick={() => acknowledge.mutate(run.id)}>
                    Mark handled
                  </Button>
                </div>
                {run.escalations.map((esc) => (
                  <div key={esc.kind} className="grid gap-0.5">
                    <span className="text-[13px] font-medium text-rose-800">{esc.summary}</span>
                    {esc.recommendedAction ? (
                      <span className="text-[13px] text-ink-600">→ {esc.recommendedAction}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Surface>
      ) : null}

      <Surface>
        <SurfaceHeader
          eyebrow="History"
          title="Operator log"
          description="Every run: what it observed, fixed, and flagged. Open one to read the full entry."
        />

        {runs.data && runs.data.length === 0 ? (
          <p className="text-[13px] text-ink-500">No runs yet. Press “Run a check now”.</p>
        ) : null}

        <div className="grid gap-2">
          {(runs.data ?? []).map((run) => (
            <div key={run.id} className="rounded-[var(--radius-md)] border border-hairline">
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
                onClick={() => setOpenId(openId === run.id ? null : run.id)}
              >
                <div className="flex items-center gap-3">
                  <StatusPill tone={HEALTH_TONE[run.healthLevel]}>{HEALTH_LABEL[run.healthLevel]}</StatusPill>
                  <span className="text-[13px] text-ink-800">{run.summary}</span>
                </div>
                <span className="text-[12px] text-ink-400">{formatRelativeTime(run.ranAt)}</span>
              </button>
              {openId === run.id ? <RunJournal runId={run.id} /> : null}
            </div>
          ))}
        </div>
      </Surface>

      {notes.data?.notes ? (
        <Surface>
          <SurfaceHeader
            eyebrow="Memory"
            title="What the Operator has learned"
            description="Durable notes it keeps across runs, and reads back before each new one."
          />
          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-ink-700">{notes.data.notes}</pre>
        </Surface>
      ) : null}
    </div>
  );
}
