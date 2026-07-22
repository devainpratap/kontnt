import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { JobArtifact } from "@semantic-seo/shared";

import { api } from "../lib/api";
import { StatusPill } from "./StatusPill";

type AuditReportsProps = {
  jobId: string;
  artifacts: JobArtifact[];
};

function AuditReportCard({ jobId, artifact }: { jobId: string; artifact: JobArtifact }) {
  const [open, setOpen] = useState(false);

  const reportQuery = useQuery({
    queryKey: ["audit", jobId, artifact.type],
    queryFn: () => api.fetchText(artifact.url),
    enabled: open
  });

  return (
    <div className="grid gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-sm font-semibold text-stone-900">{artifact.label}</span>
          <span className="text-xs text-stone-500">What the quality engine flagged and repaired.</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-stone-800 transition hover:border-emerald-400 hover:bg-white"
        >
          {open ? "Hide audit" : "View audit"}
        </button>
      </div>

      {open ? (
        <div className="grid gap-2">
          {reportQuery.isLoading ? (
            <p className="text-xs text-stone-500">Loading audit report...</p>
          ) : reportQuery.isError ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2">
              <p className="text-xs text-rose-800">Could not load this audit report.</p>
              <button
                type="button"
                onClick={() => reportQuery.refetch()}
                className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-800 transition hover:bg-white"
              >
                Retry
              </button>
            </div>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-stone-200 bg-white px-3 py-3 font-mono text-xs leading-6 text-stone-800">
              {reportQuery.data}
            </pre>
          )}
          <a
            href={artifact.downloadUrl}
            className="justify-self-start text-xs font-semibold text-emerald-800 hover:text-emerald-950"
          >
            Download {artifact.label}
          </a>
        </div>
      ) : null}
    </div>
  );
}

export function AuditReports({ jobId, artifacts }: AuditReportsProps) {
  const auditArtifacts = artifacts.filter((artifact) => artifact.category === "audit" && artifact.exists);

  if (!auditArtifacts.length) {
    return null;
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Quality audits</p>
        <StatusPill label="completed" compact />
      </div>
      {auditArtifacts.map((artifact) => (
        <AuditReportCard key={artifact.type} jobId={jobId} artifact={artifact} />
      ))}
    </div>
  );
}
