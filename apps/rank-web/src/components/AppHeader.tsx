import { NavLink } from "react-router-dom";

const linkBase =
  "rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-brand-500/40";

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? `${linkBase} bg-brand-50 text-brand-700`
    : `${linkBase} text-ink-600 hover:bg-ink-100 hover:text-ink-800`;
}

export function AppHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-brand-600 font-display text-lg font-bold text-white"
        >
          R
        </span>
        <div className="grid">
          <span className="font-display text-lg font-semibold leading-tight text-ink-900">RankOS</span>
          <span className="text-[12px] text-ink-500">Search Console intelligence and rank tracking</span>
        </div>
      </div>

      <nav className="flex items-center gap-1">
        <NavLink to="/" end className={navClass}>
          Clients
        </NavLink>
        <NavLink to="/operator" className={navClass}>
          Operator
        </NavLink>
        <NavLink to="/settings" className={navClass}>
          Settings
        </NavLink>
      </nav>
    </header>
  );
}
