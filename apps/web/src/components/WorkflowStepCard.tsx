import type { ReactNode } from "react";

import { StatusPill } from "./StatusPill";

type WorkflowStepCardProps = {
  index: number;
  title: string;
  description: string;
  status: string;
  detail?: string;
  isCurrent?: boolean;
  children?: ReactNode;
};

export function WorkflowStepCard({ index, title, description, status, detail, isCurrent = false, children }: WorkflowStepCardProps) {
  const isRunning = status === "running";
  const isDone = status === "completed";

  return (
    <section
      className={`grid gap-4 rounded-[var(--radius-md)] border px-4 py-4 transition ${
        isCurrent ? "border-brand-300 bg-brand-50/70 shadow-soft" : "border-hairline bg-white/55"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${
              isCurrent
                ? "bg-brand-700 text-ink-50"
                : isDone
                ? "bg-brand-100 text-brand-800"
                : "border border-ink-200 bg-white text-ink-600"
            }`}
          >
            {isDone ? "✓" : index}
          </span>
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
            <p className="text-sm leading-6 text-ink-600">{description}</p>
          </div>
        </div>
        <StatusPill label={status} compact />
      </div>

      {detail ? <p className="text-xs leading-5 text-ink-500">{detail}</p> : null}
      {isRunning ? (
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-brand-200 bg-white/70 px-3 py-3">
          <div className="progress-track h-1.5" />
          <p className="text-xs font-medium text-brand-700">Running now. This panel refreshes the moment the step finishes.</p>
        </div>
      ) : null}
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </section>
  );
}
