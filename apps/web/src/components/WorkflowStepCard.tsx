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

  return (
    <section
      className={`grid gap-4 rounded-2xl border px-4 py-4 transition ${
        isCurrent ? "border-emerald-300 bg-emerald-50/70" : "border-stone-200 bg-stone-50/70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
              isCurrent ? "bg-emerald-800 text-white" : "bg-white text-stone-700"
            }`}
          >
            {index}
          </span>
          <div className="grid gap-1">
            <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
            <p className="text-sm leading-6 text-stone-600">{description}</p>
          </div>
        </div>
        <StatusPill label={status} />
      </div>

      {detail ? <p className="text-xs leading-5 text-stone-500">{detail}</p> : null}
      {isRunning ? (
        <div className="grid gap-2 rounded-xl border border-sky-200 bg-white/75 px-3 py-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-sky-100">
            <div className="h-full w-2/3 rounded-full bg-sky-500 animate-pulse" />
          </div>
          <p className="text-xs font-medium text-sky-800">Running now. This panel will refresh as soon as the step finishes.</p>
        </div>
      ) : null}
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </section>
  );
}
