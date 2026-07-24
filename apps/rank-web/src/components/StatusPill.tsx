import type { ReactNode } from "react";

type Tone = "neutral" | "good" | "warn" | "bad" | "unknown";

const tones: Record<Tone, string> = {
  neutral: "border-ink-200 bg-ink-50 text-ink-600",
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  bad: "border-rose-200 bg-rose-50 text-rose-700",
  // "We don't know" is visually distinct from every other state on purpose —
  // it must never be mistaken for a real reading.
  unknown: "border-dashed border-ink-300 bg-white text-ink-500"
};

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
