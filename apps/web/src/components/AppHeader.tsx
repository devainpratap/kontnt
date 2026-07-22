import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../lib/api";

function CodexStatus() {
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
    retry: false,
    staleTime: 15_000
  });

  const settings = settingsQuery.data;
  const connected = Boolean(settings?.codexAvailable && settings?.codexAuthenticated);
  const providerLabel = settings?.generationProvider === "codex" ? "Codex" : "Claude";

  const state = settingsQuery.isError
    ? { dot: "bg-ink-400", text: "Backend offline", tone: "text-ink-500" }
    : settingsQuery.isLoading
    ? { dot: "bg-ink-300 animate-pulse", text: "Checking engine…", tone: "text-ink-500" }
    : connected
    ? { dot: "bg-emerald-500", text: `${providerLabel} connected`, tone: "text-ink-700" }
    : { dot: "bg-amber-500", text: "Manual mode", tone: "text-ink-700" };

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-xs font-medium shadow-soft"
      title={settings?.workspaceRoot ? `Workspace: ${settings.workspaceRoot}` : undefined}
    >
      <span className={`h-2 w-2 rounded-full ${state.dot}`} />
      <span className={state.tone}>{state.text}</span>
    </span>
  );
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-3 lg:px-8">
        <Link to="/" className="group inline-flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand-600 font-display text-base text-white shadow-soft">
            C
          </span>
          <span className="grid leading-none">
            <span className="font-display text-[15px] text-ink-900 transition-colors group-hover:text-brand-700">ContentOS</span>
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">Semantic SEO Workflow</span>
          </span>
        </Link>
        <CodexStatus />
      </div>
    </header>
  );
}
