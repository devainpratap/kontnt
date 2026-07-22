import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { JobArtifact } from "@semantic-seo/shared";

import { api } from "../lib/api";
import { Button } from "./Button";
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
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-hairline bg-white/55 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-sm font-semibold text-ink-900">{artifact.label}</span>
          <span className="text-xs text-ink-500">What the quality engine flagged and repaired.</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide audit" : "View audit"}
        </Button>
      </div>

      {open ? (
        <div className="grid gap-2">
          {reportQuery.isLoading ? (
            <p className="text-xs text-ink-500">Loading audit report…</p>
          ) : reportQuery.isError ? (
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-rose-50 px-3 py-2">
              <p className="text-xs text-rose-800">Could not load this audit report.</p>
              <Button variant="danger" size="sm" onClick={() => reportQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] border border-hairline bg-white px-3 py-3 font-mono text-xs leading-6 text-ink-800">
              {reportQuery.data}
            </pre>
          )}
          <a href={artifact.downloadUrl} className="justify-self-start text-xs font-semibold text-brand-700 hover:text-brand-900">
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500">Quality audits</p>
        <StatusPill label="completed" compact />
      </div>
      {auditArtifacts.map((artifact) => (
        <AuditReportCard key={artifact.type} jobId={jobId} artifact={artifact} />
      ))}
    </div>
  );
}
