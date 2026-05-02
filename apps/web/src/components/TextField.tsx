import type { ReactNode, TextareaHTMLAttributes } from "react";

type TextFieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function FieldShell({ label, hint, children }: TextFieldProps) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-stone-800">{label}</span>
      {children}
      {hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

export function inputClassName() {
  return "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100";
}

export function textAreaClassName(rows = 5) {
  return `${inputClassName()} min-h-[${rows * 1.5}rem]`;
}

export function ReadOnlyArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputClassName()} min-h-56 resize-y bg-stone-50 font-mono text-xs leading-6`}
      readOnly
    />
  );
}

