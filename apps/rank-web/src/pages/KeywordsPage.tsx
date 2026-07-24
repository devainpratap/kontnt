import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import type { KeywordSuggestion, KeywordWithStatus } from "@rankos/shared";

import { Button } from "../components/Button";
import { PositionChart } from "../components/PositionChart";
import { StatusPill } from "../components/StatusPill";
import { Surface, SurfaceHeader } from "../components/Surface";
import { TextAreaField } from "../components/TextField";
import { api } from "../lib/api";
import { UNKNOWN, formatPosition, formatRelativeTime } from "../lib/format";

const REASON_LABELS: Record<KeywordSuggestion["reasons"][number], { label: string; hint: string }> = {
  "striking-distance": {
    label: "Striking distance",
    hint: "Ranking just off the positions that earn clicks — the most movable."
  },
  cannibalization: {
    label: "Cannibalization",
    hint: "More than one of your pages ranks for this, so Google is choosing for you."
  },
  "high-impression-low-ctr": {
    label: "Low CTR",
    hint: "Ranks well but under-earns — usually a title or snippet problem, not a ranking one."
  }
};

function ImportPanel({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [raw, setRaw] = useState("");

  const importKeywords = useMutation({
    mutationFn: () => api.importKeywords(clientId, { raw, country: "in", device: "desktop", tags: [], cadence: "weekly" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["keywords", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["suggestions", clientId] });
    }
  });

  const result = importKeywords.data;

  return (
    <Surface>
      <SurfaceHeader
        eyebrow="Bulk add"
        title="Paste keywords"
        description="One per line. Optionally add a target URL after a comma. A pasted header row is skipped and duplicates are ignored."
      />

      <TextAreaField
        label="Keywords"
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        placeholder={"digital marketing agency in noida, https://adclear.in/\nseo agency in noida\nppc agency noida"}
        hint="Comma or tab separated. Re-pasting a longer list is safe."
      />

      {result ? (
        <div className="grid gap-1 rounded-[var(--radius-md)] border border-hairline bg-ink-50 px-3 py-2 text-[13px]">
          <p className="text-ink-700">
            Added <strong>{result.created}</strong>
            {result.duplicates > 0 ? `, skipped ${result.duplicates} already tracked` : ""}
            {result.invalid.length > 0 ? `, ${result.invalid.length} could not be read` : ""}.
          </p>
          {result.invalid.map((entry) => (
            <p key={entry.line} className="text-amber-700">
              “{entry.line.slice(0, 60)}” — {entry.reason}
            </p>
          ))}
        </div>
      ) : null}

      {importKeywords.isError ? (
        <p className="text-[13px] text-rose-700">{(importKeywords.error as Error).message}</p>
      ) : null}

      <div className="flex gap-2">
        <Button loading={importKeywords.isPending} disabled={!raw.trim()} onClick={() => importKeywords.mutate()}>
          Import
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </Surface>
  );
}

function SuggestionsPanel({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(90);

  const suggestions = useQuery({
    queryKey: ["suggestions", clientId, days],
    queryFn: () => api.getSuggestions(clientId, days)
  });

  const addKeyword = useMutation({
    mutationFn: (suggestion: KeywordSuggestion) =>
      api.createKeyword(clientId, {
        phrase: suggestion.query,
        country: "in",
        device: "desktop",
        targetUrl: suggestion.topPage || null,
        tags: ["from-gsc"],
        cadence: "weekly"
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["keywords", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["suggestions", clientId] });
    }
  });

  const data = suggestions.data;

  return (
    <Surface>
      <SurfaceHeader
        eyebrow="From your Search Console data"
        title="Suggested keywords"
        description="Queries this site already earns impressions for but you are not tracking yet. Derived from your own data — nothing is scraped."
        aside={
          <div className="flex items-center gap-1">
            {[28, 90, 180].map((option) => (
              <Button
                key={option}
                size="sm"
                variant={days === option ? "primary" : "ghost"}
                onClick={() => setDays(option)}
              >
                {option}d
              </Button>
            ))}
          </div>
        }
      />

      {suggestions.isLoading ? <p className="text-sm text-ink-500">Analysing Search Console history…</p> : null}

      {data && data.suggestions.length === 0 ? (
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-ink-300 px-4 py-6 text-center">
          <p className="text-sm font-medium text-ink-700">No suggestions in this window</p>
          <p className="text-[13px] text-ink-500">
            {data.totals.candidates === 0
              ? "There is no Search Console data yet — run a sync first."
              : `Looked at ${data.totals.candidates.toLocaleString()} queries. ${data.totals.alreadyTracked} are already tracked and ${data.totals.brandExcluded} were branded.`}
          </p>
        </div>
      ) : null}

      {data && data.suggestions.length > 0 ? (
        <>
          <p className="text-[12px] text-ink-500">
            {data.totals.candidates.toLocaleString()} queries analysed · {data.totals.alreadyTracked} already tracked ·{" "}
            {data.totals.brandExcluded} branded and excluded
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">Query</th>
                  <th className="py-2 pr-3 text-right font-medium">Impr.</th>
                  <th className="py-2 pr-3 text-right font-medium">Clicks</th>
                  <th className="py-2 pr-3 text-right font-medium">GSC pos.</th>
                  <th className="py-2 pr-3 text-right font-medium" title="Modelled extra clicks if this reached position 3. An estimate for ranking candidates, not a forecast.">
                    Upside*
                  </th>
                  <th className="py-2 pr-3 font-medium">Why</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.suggestions.map((suggestion) => (
                  <tr key={suggestion.query} className="border-b border-hairline/60 last:border-0">
                    <td className="py-2 pr-3 text-ink-800">{suggestion.query}</td>
                    <td className="tabular py-2 pr-3 text-right text-ink-600">
                      {suggestion.impressions.toLocaleString()}
                    </td>
                    <td className="tabular py-2 pr-3 text-right text-ink-600">{suggestion.clicks}</td>
                    <td className="tabular py-2 pr-3 text-right text-ink-700">
                      {suggestion.position.toFixed(1)}
                    </td>
                    <td className="tabular py-2 pr-3 text-right font-medium text-ink-800">
                      +{suggestion.opportunityClicks}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {suggestion.reasons.map((reason) => (
                          <span
                            key={reason}
                            title={REASON_LABELS[reason].hint}
                            className="rounded-full border border-ink-200 bg-ink-50 px-2 py-0.5 text-[11px] text-ink-600"
                          >
                            {REASON_LABELS[reason].label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={addKeyword.isPending && addKeyword.variables?.query === suggestion.query}
                        onClick={() => addKeyword.mutate(suggestion)}
                      >
                        Track
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] leading-5 text-ink-400">
            * Upside is modelled from published average click-through rates by position, applied to this query&rsquo;s
            impressions. It exists to rank candidates against each other, not to predict traffic.
          </p>
        </>
      ) : null}
    </Surface>
  );
}


/**
 * Live rank-check controls and health.
 *
 * The health strip is not decoration: it is how a degrading scraper becomes
 * visible. A run that returns nothing but "blocked" must look different from
 * one that found no rankings.
 */
function RankCheckPanel({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ["serp-status", clientId],
    queryFn: () => api.getSerpStatus(clientId),
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false)
  });

  const run = useMutation({
    mutationFn: (dueOnly: boolean) => api.runSerpCheck(clientId, { dueOnly }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["serp-status", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["keywords", clientId] });
    }
  });

  const data = status.data;
  const health = data?.health;
  const totalChecks = health ? health.ok + health.notFound + health.blocked + health.error : 0;
  const lastRun = data?.runs?.[0];

  return (
    <Surface>
      <SurfaceHeader
        eyebrow="Live SERP"
        title="Rank checks"
        description="Checks run one at a time with a long random gap, which is what keeps the free local browser working. Expect roughly a minute per keyword."
        aside={data?.running ? <StatusPill tone="warn">Checking…</StatusPill> : null}
      />

      {data ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-600">
            <span>
              Provider: <strong className="text-ink-800">{data.provider}</strong>
            </span>
            <span>
              Budget today: <strong className="text-ink-800">{data.remainingToday}</strong> of {data.dailyCap} left
            </span>
          </div>

          {data.budgets && data.budgets.length > 0 ? (
            <div className="grid gap-1 rounded-[var(--radius-md)] border border-hairline bg-ink-50/60 px-3 py-2">
              <span className="text-[12px] font-medium text-ink-700">
                Free monthly quota (resets {data.budgets[0]?.resetsOn})
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-600">
                {data.budgets.map((budget) => (
                  <span key={budget.provider} className="tabular">
                    {budget.provider}:{" "}
                    {budget.remaining === null ? (
                      // No free tier — billed per request, so a countdown would be misleading.
                      <strong className="text-ink-700">pay-per-use</strong>
                    ) : (
                      <strong className={budget.remaining === 0 ? "text-rose-600" : "text-ink-800"}>
                        {budget.remaining.toLocaleString()} left
                      </strong>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {totalChecks > 0 && health ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-ink-500">Last 7 days:</span>
              <StatusPill tone="good">{health.ok} ranked</StatusPill>
              <StatusPill tone="neutral">{health.notFound} not in top 100</StatusPill>
              {health.blocked > 0 ? <StatusPill tone="warn">{health.blocked} blocked</StatusPill> : null}
              {health.error > 0 ? <StatusPill tone="bad">{health.error} failed</StatusPill> : null}
            </div>
          ) : null}

          {health && health.blocked > 0 && health.blocked >= health.ok ? (
            <p className="rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              Most checks are being blocked. Google is challenging this IP. Leave it for a few hours, or set
              <code className="mx-1">SERP_PROVIDER=dataforseo</code> in .env — roughly $2/month at this volume.
            </p>
          ) : null}

          {lastRun ? (
            <p className="text-[12px] text-ink-500">
              Last run: {lastRun.status} · {lastRun.itemsOk} ok · {lastRun.itemsBlocked} blocked ·{" "}
              {lastRun.itemsFailed} failed
              {lastRun.errorMessage ? ` — ${lastRun.errorMessage}` : ""}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={data.running || data.remainingToday <= 0}
              loading={run.isPending && run.variables === true}
              onClick={() => run.mutate(true)}
            >
              Check due keywords
            </Button>
            <Button
              variant="secondary"
              disabled={data.running || data.remainingToday <= 0}
              loading={run.isPending && run.variables === false}
              onClick={() => run.mutate(false)}
            >
              Check all now
            </Button>
            {data.running ? (
              <Button variant="ghost" onClick={() => api.cancelSerpCheck(clientId)}>
                Cancel
              </Button>
            ) : null}
          </div>

          {run.isSuccess ? (
            <p className="text-[13px] text-ink-600">
              Queued {run.data.queued} checks — roughly {run.data.estimatedMinutes} minutes. You can leave this page;
              progress is saved as it goes.
            </p>
          ) : null}

          {run.isError ? <p className="text-[13px] text-rose-700">{(run.error as Error).message}</p> : null}
        </div>
      ) : null}
    </Surface>
  );
}

function KeywordHistoryPanel({ keywordId, phrase }: { keywordId: string; phrase: string }) {
  const history = useQuery({
    queryKey: ["keyword-history", keywordId],
    queryFn: () => api.getKeywordHistory(keywordId)
  });

  if (history.isLoading) {
    return <p className="p-4 text-[13px] text-ink-500">Loading history…</p>;
  }

  const data = history.data;
  if (!data) {
    return null;
  }

  return (
    <div className="grid gap-4 border-t border-hairline bg-ink-50/40 p-4">
      <div>
        <h4 className="mb-2 text-[13px] font-medium text-ink-700">Position history — {phrase}</h4>
        <PositionChart history={data.history} />
      </div>

      {data.latestSerp.results.length > 0 ? (
        <div>
          <h4 className="mb-2 text-[13px] font-medium text-ink-700">
            Top 10 as of {data.latestSerp.checkedAt?.slice(0, 10)}
          </h4>
          <ol className="grid gap-1">
            {data.latestSerp.results.slice(0, 10).map((result) => (
              <li
                key={result.id}
                className={`flex items-baseline gap-2 rounded px-2 py-1 text-[13px] ${
                  result.isClient ? "bg-brand-50 font-medium text-brand-800" : "text-ink-600"
                }`}
              >
                <span className="tabular w-6 shrink-0 text-right text-ink-400">{result.position}</span>
                <span className="shrink-0">{result.domain}</span>
                <span className="truncate text-ink-400">{result.title}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function KeywordTable({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();

  const keywords = useQuery({
    queryKey: ["keywords", clientId],
    queryFn: () => api.listKeywords(clientId)
  });

  const remove = useMutation({
    mutationFn: (keywordId: string) => api.deleteKeyword(keywordId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["keywords", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["suggestions", clientId] });
    }
  });

  const rows = keywords.data ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Surface>
      <SurfaceHeader
        eyebrow="Tracking"
        title={`Keywords${rows.length ? ` (${rows.length})` : ""}`}
        description="Tracked rank arrives with the SERP layer in the next phase. Search Console position is shown now."
      />

      {keywords.isLoading ? <p className="text-sm text-ink-500">Loading keywords…</p> : null}

      {rows.length === 0 && !keywords.isLoading ? (
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-ink-300 px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink-700">No keywords tracked yet</p>
          <p className="text-[13px] text-ink-500">Add them from the suggestions below, or paste your own list.</p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-500">
                <th className="py-2 pr-3 font-medium">Keyword</th>
                <th className="py-2 pr-3 font-medium">Market</th>
                <th className="py-2 pr-3 text-right font-medium" title="Impression-weighted average from Search Console, last 28 days">
                  GSC pos.
                </th>
                <th className="py-2 pr-3 text-right font-medium" title="Live SERP rank — arrives with the SERP layer">
                  Tracked rank
                </th>
                <th className="py-2 pr-3 font-medium">Last checked</th>
                <th className="py-2 pr-3 font-medium">Cadence</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((keyword: KeywordWithStatus) => (
                <Fragment key={keyword.id}>
                <tr className="border-b border-hairline/60 last:border-0">
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      className="text-left text-ink-800 hover:text-brand-700 hover:underline"
                      onClick={() => setExpandedId(expandedId === keyword.id ? null : keyword.id)}
                    >
                      {keyword.phrase}
                    </button>
                    {keyword.tags.length > 0 ? (
                      <span className="ml-2 text-[11px] text-ink-400">{keyword.tags.join(", ")}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-[13px] text-ink-500">
                    {keyword.country.toUpperCase()} · {keyword.device}
                  </td>
                  <td className="tabular py-2 pr-3 text-right text-ink-700">
                    {formatPosition(keyword.gscPosition)}
                  </td>
                  <td className="tabular py-2 pr-3 text-right">
                    {keyword.latestCheck?.status === "ok" ? (
                      <span className="text-ink-800">{formatPosition(keyword.latestCheck.position)}</span>
                    ) : keyword.latestCheck ? (
                      // A blocked or failed check is explicitly unknown, never a drop.
                      <StatusPill tone="unknown">{keyword.latestCheck.status}</StatusPill>
                    ) : (
                      <span className="text-ink-400">{UNKNOWN}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[13px] text-ink-500">
                    {keyword.latestCheck ? formatRelativeTime(keyword.latestCheck.checkedAt) : "Never"}
                  </td>
                  <td className="py-2 pr-3 text-[13px] text-ink-500">{keyword.cadence}</td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove.mutate(keyword.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
                {expandedId === keyword.id ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <KeywordHistoryPanel keywordId={keyword.id} phrase={keyword.phrase} />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Surface>
  );
}

export function KeywordsPage() {
  const { clientId = "" } = useParams();
  const [showImport, setShowImport] = useState(false);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api.getClient(clientId),
    enabled: Boolean(clientId)
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <Link className="text-[13px] text-brand-700 hover:underline" to={`/clients/${clientId}`}>
            ← {client.data?.name ?? "Client"}
          </Link>
          <h1 className="font-display text-2xl text-ink-900">Keyword tracking</h1>
        </div>
        {!showImport ? <Button onClick={() => setShowImport(true)}>Paste keywords</Button> : null}
      </div>

      {showImport ? <ImportPanel clientId={clientId} onDone={() => setShowImport(false)} /> : null}

      <RankCheckPanel clientId={clientId} />
      <KeywordTable clientId={clientId} />
      <SuggestionsPanel clientId={clientId} />
    </div>
  );
}
