import type { ReactNode, TextareaHTMLAttributes } from "react";

type TextFieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function FieldShell({ label, hint, children }: TextFieldProps) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-medium text-ink-700">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function inputClassName() {
  return "w-full rounded-[var(--radius-md)] border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25";
}

export function textAreaClassName(minRows = 4) {
  // Tailwind can't compile a dynamic arbitrary class, so map rows -> a fixed min-height utility.
  const minHeight = minRows <= 3 ? "min-h-20" : minRows <= 5 ? "min-h-28" : "min-h-40";
  return `${inputClassName()} ${minHeight} resize-y leading-6`;
}

export function ReadOnlyArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputClassName()} min-h-56 resize-y bg-ink-50 font-mono text-xs leading-6 text-ink-700`}
      readOnly
    />
  );
}
