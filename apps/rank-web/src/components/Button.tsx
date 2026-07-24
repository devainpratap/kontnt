import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-4 py-2 text-sm"
};

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-soft hover:bg-brand-700 active:bg-brand-800",
  secondary: "border border-ink-200 bg-white text-brand-700 hover:border-brand-300 hover:bg-brand-50",
  ghost: "border border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50",
  danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
};

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

type ButtonProps = {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[base, sizes[size], variants[variant], className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
