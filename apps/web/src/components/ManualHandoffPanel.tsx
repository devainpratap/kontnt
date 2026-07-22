import { useState } from "react";

type ManualHandoffPanelProps = {
  stepLabel: string;
  handoff: string;
};

export function ManualHandoffPanel({ stepLabel, handoff }: ManualHandoffPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(handoff);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="grid gap-3 rounded-[var(--radius-card)] border border-amber-300/80 bg-amber-50/70 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Manual handoff</p>
          <h4 className="text-sm font-semibold text-ink-900">Codex was unavailable for {stepLabel.toLowerCase()}</h4>
          <p className="max-w-2xl text-sm leading-6 text-ink-700">
            Copy the prompt below and run it manually in Codex or ChatGPT, then paste the result back into this workspace
            and save it. This is a prompt to run, not finished content.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-[var(--radius-md)] border border-amber-400 bg-white px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          {copied ? "Copied" : "Copy prompt"}
        </button>
      </div>
      <textarea
        value={handoff}
        readOnly
        className="min-h-40 w-full resize-y rounded-[var(--radius-md)] border border-amber-200 bg-white/80 px-3 py-2.5 font-mono text-xs leading-6 text-ink-800 outline-none"
      />
    </section>
  );
}
