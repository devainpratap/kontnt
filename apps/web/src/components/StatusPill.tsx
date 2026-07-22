type StatusPillProps = {
  label: string;
  compact?: boolean;
};

/*
 * Five semantic families with subtle inset rings for a clean, legible chip:
 *   brand   — primary / connected (Codex)
 *   success — any "ready", approved, or completed step
 *   progress— running / in-flight
 *   attention — manual handoff needed
 *   danger  — error / failed
 *   neutral — draft / idle / unknown
 */
const familyClasses = {
  brand: "bg-brand-600 text-white",
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  progress: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  attention: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  danger: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  neutral: "bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-500/15"
} as const;

const statusFamily: Record<string, keyof typeof familyClasses> = {
  codex: "brand",
  claude: "brand",
  "semantic-map-ready": "success",
  "outline-ready": "success",
  "outline-approved": "success",
  "draft-ready": "success",
  "final-ready": "success",
  completed: "success",
  running: "progress",
  "manual-input-required": "attention",
  error: "danger",
  failed: "danger",
  draft: "neutral",
  idle: "neutral"
};

const displayLabelMap: Record<string, string> = {
  "manual-input-required": "manual handoff"
};

export function StatusPill({ label, compact = false }: StatusPillProps) {
  const isRunning = label === "running";
  const family = familyClasses[statusFamily[label] ?? "neutral"];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.06em] ${
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
      } ${family}`}
    >
      {isRunning ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80 animate-pulse" /> : null}
      {(displayLabelMap[label] ?? label).replaceAll("-", " ")}
    </span>
  );
}
