import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const fieldClass =
  "w-full rounded-[var(--radius-md)] border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 " +
  "placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/25";

type FieldShellProps = {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
};

function FieldShell({ label, hint, error, required, children }: FieldShellProps & { children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-medium text-ink-700">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="text-[12px] text-rose-600">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-ink-500">{hint}</span>
      ) : null}
    </label>
  );
}

type TextFieldProps = FieldShellProps & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export function TextField({ label, hint, error, required, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      <input className={fieldClass} aria-invalid={error ? true : undefined} {...rest} />
    </FieldShell>
  );
}

type TextAreaFieldProps = FieldShellProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">;

export function TextAreaField({ label, hint, error, required, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      <textarea className={`${fieldClass} min-h-[80px] resize-y`} aria-invalid={error ? true : undefined} {...rest} />
    </FieldShell>
  );
}
