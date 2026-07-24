import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import type { GscSite } from "@rankos/shared";

import { AlertsInbox } from "../components/AlertsInbox";
import { Button } from "../components/Button";
import { KpiRow } from "../components/KpiRow";
import { StatusPill } from "../components/StatusPill";
import { Surface, SurfaceHeader } from "../components/Surface";
import { TrendChart } from "../components/TrendChart";
import { api } from "../lib/api";
import { formatRelativeTime } from "../lib/format";

// Validated categorical slots 1 and 2 (see the palette validator run).
const CLICKS_COLOR = "#2a78d6";
const IMPRESSIONS_COLOR = "#eb6834";

const RANGES = [
  { days: 7, label: "7d" },
  { days: 28, label: "28d" },
  { days: 90, label: "90d" },
  { days: 365, label: "12mo" }
];

function PropertyPicker({ clientId, current }: { clientId: string; current: string | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const properties = useQuery({
    queryKey: ["google-properties"],
    queryFn: api.listProperties,
    enabled: open,
    retry: false
  });

  const link = useMutation({
    mutationFn: (gscProperty: string) => api.updateClient(clientId, { gscProperty }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["client", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
    }
  });

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {current ? "Change property" : "Link a property"}
      </Button>
    );
  }

  return (
    <div className="grid gap-2">
      {properties.isLoading ? <p className="text-[13px] text-ink-500">Loading properties…</p> : null}

      {properties.isError ? (
        <p className="text-[13px] text-rose-700">
          {(properties.error as Error).message} — connect Google on the{" "}
          <Link className="underline" to="/settings">
            settings page
          </Link>{" "}
          first.
        </p>
      ) : null}

      {properties.data && properties.data.length === 0 ? (
        <p className="text-[13px] text-ink-500">
          This Google account has no verified Search Console properties.
        </p>
      ) : null}

      {properties.data && properties.data.length > 0 ? (
        <div className="grid max-h-64 gap-1 overflow-y-auto">
          {properties.data.map((site: GscSite) => (
            <button
              key={site.siteUrl}
              type="button"
              onClick={() => link.mutate(site.siteUrl)}
              disabled={link.isPending}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-ink-200 px-3 py-2 text-left text-[13px] hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
            >
              <span className="break-all text-ink-800">{site.siteUrl}</span>
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-400">
                {site.propertyType}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

export function ClientDetailPage() {
  const { clientId = "" } = useParams();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(28);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api.getClient(clientId),
    enabled: Boolean(clientId)
  });

  const syncStatus = useQuery({
    queryKey: ["sync-status", clientId],
    queryFn: () => api.getSyncStatus(clientId),
    enabled: Boolean(clientId),
    // Poll while a sync is in flight; a backfill takes minutes.
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false)
  });

  const performance = useQuery({
    queryKey: ["performance", clientId, days],
    queryFn: () => api.getPerformance(clientId, days),
    enabled: Boolean(clientId)
  });

  const runSync = useMutation({
    mutationFn: (kind: "sync" | "backfill") =>
      kind === "backfill" ? api.backfillGsc(clientId) : api.syncGsc(clientId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sync-status", clientId] });
    }
  });

  // When a run finishes, pull the fresh numbers in.
  const running = syncStatus.data?.running ?? false;
  const lastRun = syncStatus.data?.runs?.[0];

  if (client.isLoading) {
    return <p className="text-sm text-ink-500">Loading client…</p>;
  }

  if (client.isError || !client.data) {
    return (
      <Surface>
        <SurfaceHeader title="Client not found" description="This client may have been removed." />
        <Link className="text-sm text-brand-700 hover:underline" to="/">
          Back to clients
        </Link>
      </Surface>
    );
  }

  const record = client.data;
  const coverage = performance.data?.coverage;

  return (
    <div className="grid gap-6">
      <AlertsInbox clientId={record.id} />
      <Surface>
        <SurfaceHeader
          eyebrow="Client"
          title={record.name}
          description={record.primaryDomain}
          aside={
            <>
              <Link
                to={`/clients/${record.id}/keywords`}
                className="rounded-[var(--radius-md)] border border-ink-200 bg-white px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:border-brand-300 hover:bg-brand-50"
              >
                Keywords
              </Link>
              <Link
                to={`/clients/${record.id}/insights`}
                className="rounded-[var(--radius-md)] border border-ink-200 bg-white px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:border-brand-300 hover:bg-brand-50"
              >
                Reports
              </Link>
              {running ? (
                <StatusPill tone="warn">Syncing…</StatusPill>
              ) : record.gscProperty ? (
                <StatusPill tone="good">Search Console linked</StatusPill>
              ) : (
                <StatusPill tone="warn">Not linked</StatusPill>
              )}
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <span className="text-[12px] uppercase tracking-wide text-ink-500">Search Console property</span>
            <span className="break-all text-sm text-ink-800">{record.gscProperty ?? "Not linked"}</span>
            <PropertyPicker clientId={record.id} current={record.gscProperty} />
          </div>

          <div className="grid gap-2">
            <span className="text-[12px] uppercase tracking-wide text-ink-500">Data</span>
            <span className="text-sm text-ink-800">
              {syncStatus.data?.bounds.earliest
                ? `${syncStatus.data.bounds.earliest} → ${syncStatus.data.bounds.latest}`
                : "No data synced yet"}
            </span>
            {lastRun ? (
              <span className="text-[12px] text-ink-500">
                Last run: {lastRun.kind} · {lastRun.status} · {formatRelativeTime(lastRun.completedAt ?? lastRun.startedAt)}
                {lastRun.rowsWritten ? ` · ${lastRun.rowsWritten.toLocaleString()} rows` : ""}
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={running || !record.gscProperty}
                loading={runSync.isPending && runSync.variables === "sync"}
                onClick={() => runSync.mutate("sync")}
              >
                Sync recent
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={running || !record.gscProperty}
                loading={runSync.isPending && runSync.variables === "backfill"}
                onClick={() => runSync.mutate("backfill")}
              >
                Backfill 16 months
              </Button>
              {running ? (
                <Button size="sm" variant="ghost" onClick={() => api.cancelGsc(clientId)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {runSync.isError ? (
          <p className="rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {(runSync.error as Error).message}
          </p>
        ) : null}

        {lastRun?.status === "failed" ? (
          <p className="rounded-[var(--radius-md)] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            Last sync failed: {lastRun.errorMessage}
          </p>
        ) : null}
      </Surface>

      <Surface>
        <SurfaceHeader
          eyebrow="Search Console"
          title="Performance"
          description={
            performance.data
              ? `${performance.data.window.startDate} → ${performance.data.window.endDate}, compared with the preceding ${days} days.`
              : undefined
          }
          aside={
            <div className="flex items-center gap-1">
              {RANGES.map((range) => (
                <Button
                  key={range.days}
                  size="sm"
                  variant={days === range.days ? "primary" : "ghost"}
                  onClick={() => setDays(range.days)}
                >
                  {range.label}
                </Button>
              ))}
            </div>
          }
        />

        {performance.isLoading ? <p className="text-sm text-ink-500">Loading performance…</p> : null}

        {performance.data ? (
          <div className="grid gap-6">
            <KpiRow totals={performance.data.totals} previous={performance.data.previousTotals} />

            <div className="grid gap-6">
              <TrendChart data={performance.data.daily} metric="clicks" label="Clicks" color={CLICKS_COLOR} />
              <TrendChart
                data={performance.data.daily}
                metric="impressions"
                label="Impressions"
                color={IMPRESSIONS_COLOR}
              />
            </div>

            {coverage && coverage.totalClicks > 0 ? (
              <p className="rounded-[var(--radius-md)] border border-hairline bg-ink-50 px-3 py-2 text-[12px] text-ink-600">
                {coverage.attributedClicks.toLocaleString()} of {coverage.totalClicks.toLocaleString()} clicks (
                {Math.round(coverage.coverageRatio * 100)}%) are attributed to named queries. Google withholds rare
                queries for privacy, so the query table below will always total less than the headline figure.
              </p>
            ) : null}
          </div>
        ) : null}
      </Surface>

      {performance.data && performance.data.topQueries.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Surface>
            <SurfaceHeader title="Top queries" />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-3 font-medium">Query</th>
                    <th className="py-2 pr-3 text-right font-medium">Clicks</th>
                    <th className="py-2 pr-3 text-right font-medium">Impr.</th>
                    <th className="py-2 text-right font-medium">Pos.</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.data.topQueries.slice(0, 25).map((row) => (
                    <tr key={row.query} className="border-b border-hairline/60 last:border-0">
                      <td className="py-2 pr-3 text-ink-800">{row.query}</td>
                      <td className="tabular py-2 pr-3 text-right text-ink-700">{row.clicks.toLocaleString()}</td>
                      <td className="tabular py-2 pr-3 text-right text-ink-500">{row.impressions.toLocaleString()}</td>
                      <td className="tabular py-2 text-right text-ink-700">{row.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          <Surface>
            <SurfaceHeader title="Top pages" />
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-3 font-medium">Page</th>
                    <th className="py-2 pr-3 text-right font-medium">Clicks</th>
                    <th className="py-2 pr-3 text-right font-medium">Impr.</th>
                    <th className="py-2 text-right font-medium">Pos.</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.data.topPages.slice(0, 25).map((row) => (
                    <tr key={row.page} className="border-b border-hairline/60 last:border-0">
                      <td className="max-w-[260px] truncate py-2 pr-3 text-ink-800" title={row.page}>
                        {row.page.replace(/^https?:\/\/[^/]+/, "") || "/"}
                      </td>
                      <td className="tabular py-2 pr-3 text-right text-ink-700">{row.clicks.toLocaleString()}</td>
                      <td className="tabular py-2 pr-3 text-right text-ink-500">{row.impressions.toLocaleString()}</td>
                      <td className="tabular py-2 text-right text-ink-700">{row.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
      ) : null}

      <Link className="text-sm text-brand-700 hover:underline" to="/">
        Back to clients
      </Link>
    </div>
  );
}
