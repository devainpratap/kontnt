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

function joinClassNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Surface({ children, className }: SurfaceProps) {
  return (
    <section
      className={joinClassNames(
        "grid gap-5 rounded-[28px] border border-stone-200 bg-white/88 p-6 shadow-[0_16px_48px_rgba(33,26,18,0.07)]",
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
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{eyebrow}</p> : null}
        <h2 className="text-xl font-semibold text-stone-900">{title}</h2>
        {description ? <p className="max-w-3xl text-sm leading-6 text-stone-600">{description}</p> : null}
      </div>
      {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
    </div>
  );
}
