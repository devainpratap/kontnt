import { useState } from "react";
import type { UseFormRegister } from "react-hook-form";

import type { IntakeFormValues } from "../lib/intake";
import { FieldShell, inputClassName } from "./TextField";

type AdvancedBriefFieldsProps = {
  register: UseFormRegister<IntakeFormValues>;
};

const textAreaClass = `${inputClassName()} min-h-24 resize-y leading-6`;

/**
 * The full brief beyond the 3-field happy path. Collapsed by default so the
 * default flow stays "title + keyword + URLs, Codex infers the rest", but every
 * intake field can be filled in when the operator wants tighter control.
 */
export function AdvancedBriefFields({ register }: AdvancedBriefFieldsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="grid gap-4 rounded-[var(--radius-card)] border border-hairline bg-white/50 p-4">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <span className="grid gap-0.5">
          <span className="text-sm font-semibold text-ink-900">Advanced brief (optional)</span>
          <span className="text-xs leading-5 text-ink-500">
            Override what Codex would otherwise infer: audience, intent, entities, tone, links, and CTAs.
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-ink-300 px-2.5 py-1 text-xs font-semibold text-ink-600">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded ? (
        <div className="grid gap-4">
          <FieldShell label="Intended audience">
            <input {...register("intendedAudience")} className={inputClassName()} />
          </FieldShell>

          <FieldShell label="Search intent">
            <input {...register("searchIntent")} className={inputClassName()} />
          </FieldShell>

          <FieldShell label="Competitor notes">
            <textarea {...register("competitorNotes")} className={textAreaClass} />
          </FieldShell>

          <FieldShell label="Main entities" hint="One entity per line.">
            <textarea {...register("mainEntities")} className={textAreaClass} />
          </FieldShell>

          <FieldShell label="Secondary entities" hint="One entity per line.">
            <textarea {...register("secondaryEntities")} className={textAreaClass} />
          </FieldShell>

          <FieldShell label="Brand context">
            <textarea {...register("brandContext")} className={textAreaClass} />
          </FieldShell>

          <FieldShell label="Attributes" hint="One attribute per line.">
            <textarea {...register("attributes")} className={textAreaClass} />
          </FieldShell>

          <FieldShell label="Anchor keywords" hint="One keyword per line.">
            <textarea {...register("anchorKeywords")} className={textAreaClass} />
          </FieldShell>

          <FieldShell label="Tone">
            <input {...register("tone")} className={inputClassName()} />
          </FieldShell>

          <FieldShell label="Target word count">
            <input
              type="number"
              min={1}
              {...register("targetWordCount", { valueAsNumber: true })}
              className={inputClassName()}
            />
          </FieldShell>

          <FieldShell label="Internal links" hint="One URL or reference per line.">
            <textarea {...register("internalLinks")} className={textAreaClass} />
          </FieldShell>

          <FieldShell label="Preferred CTAs" hint="One CTA per line.">
            <textarea {...register("preferredCtas")} className={textAreaClass} />
          </FieldShell>
        </div>
      ) : null}
    </div>
  );
}
