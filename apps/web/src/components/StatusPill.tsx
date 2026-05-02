type StatusPillProps = {
  label: string;
  compact?: boolean;
};

const statusClasses: Record<string, string> = {
  codex: "bg-emerald-800 text-white",
  draft: "bg-stone-200 text-stone-700",
  "semantic-map-ready": "bg-emerald-100 text-emerald-800",
  "outline-ready": "bg-teal-100 text-teal-800",
  "outline-approved": "bg-cyan-100 text-cyan-800",
  "draft-ready": "bg-blue-100 text-blue-800",
  "final-ready": "bg-lime-100 text-lime-800",
  "manual-input-required": "bg-amber-100 text-amber-800",
  error: "bg-rose-100 text-rose-800",
  idle: "bg-stone-200 text-stone-700",
  running: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800"
};

const displayLabelMap: Record<string, string> = {
  "manual-input-required": "manual handoff"
};

export function StatusPill({ label, compact = false }: StatusPillProps) {
  const isRunning = label === "running";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.08em] ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } ${
        statusClasses[label] ?? "bg-stone-200 text-stone-700"
      }`}
    >
      {isRunning ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80 animate-pulse" /> : null}
      {(displayLabelMap[label] ?? label).replaceAll("-", " ")}
    </span>
  );
}
