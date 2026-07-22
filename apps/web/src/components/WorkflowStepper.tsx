import type { ReactNode } from "react";

export type StepperItem = {
  key: string;
  label: string;
  status: string;
  isCurrent: boolean;
  detail?: string;
  action?: ReactNode;
};

function StatusNode({ status, isCurrent }: { status: string; isCurrent: boolean }) {
  if (status === "completed") {
    return (
      <span className="relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white shadow-soft">
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.4">
          <path d="m5 10.5 3.2 3.2L15 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (status === "running") {
    return (
      <span className="relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-sky-400 bg-white">
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </span>
    );
  }

  if (status === "failed" || status === "manual-input-required") {
    const tone = status === "failed" ? "border-rose-300 text-rose-500" : "border-amber-300 text-amber-500";
    return (
      <span className={`relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white ${tone}`}>
        <span className="h-2 w-2 rounded-full bg-current" />
      </span>
    );
  }

  // idle — highlight the current step with a filled brand ring
  return (
    <span
      className={`relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white ${
        isCurrent ? "border-brand-500" : "border-ink-200"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${isCurrent ? "bg-brand-500" : "bg-ink-300"}`} />
    </span>
  );
}

export function WorkflowStepper({ items }: { items: StepperItem[] }) {
  return (
    <ol className="grid">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const connectorDone = item.status === "completed";
        return (
          <li key={item.key} className="grid grid-cols-[28px_1fr] gap-x-3">
            {/* node + connector column */}
            <div className="relative flex flex-col items-center">
              <StatusNode status={item.status} isCurrent={item.isCurrent} />
              {!isLast ? (
                <span
                  className={`w-0.5 flex-1 ${connectorDone ? "bg-brand-300" : "bg-ink-200"}`}
                  style={{ minHeight: "1.25rem" }}
                />
              ) : null}
            </div>

            {/* content */}
            <div className={`min-w-0 pb-5 ${isLast ? "pb-0" : ""}`}>
              <div className="flex items-center gap-2">
                <p
                  className={`text-sm font-semibold ${
                    item.isCurrent ? "text-brand-700" : item.status === "completed" ? "text-ink-800" : "text-ink-600"
                  }`}
                >
                  {item.label}
                </p>
                {item.isCurrent ? (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-600">
                    Now
                  </span>
                ) : null}
              </div>
              {item.detail ? <p className="mt-1 text-xs leading-5 text-ink-400">{item.detail}</p> : null}
              {item.action ? <div className="mt-2.5 flex flex-wrap gap-2">{item.action}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
