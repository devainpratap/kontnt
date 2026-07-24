import type { ReactNode } from "react";

type SurfaceProps = {
  children: ReactNode;
  className?: string;
};

type SurfaceHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
};

function cx(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function Surface({ children, className }: SurfaceProps) {
  return (
    <section
      className={cx(
        "grid gap-5 rounded-[var(--radius-card)] border border-hairline bg-white p-6 shadow-soft",
        className
      )}
    >
      {children}
    </section>
  );
}

export function SurfaceHeader({ eyebrow, title, description, aside }: SurfaceHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid gap-1.5">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600">{eyebrow}</p>
        ) : null}
        <h2 className="font-display text-xl leading-tight text-ink-900">{title}</h2>
        {description ? <p className="max-w-3xl text-sm leading-6 text-ink-500">{description}</p> : null}
      </div>
      {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
    </div>
  );
}
