import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import type { InsightRecord } from "@rankos/shared";

import { Button } from "../components/Button";
import { StatusPill } from "../components/StatusPill";
import { Surface, SurfaceHeader } from "../components/Surface";
import { api } from "../lib/api";
import { formatRelativeTime } from "../lib/format";

const RANGES = [
  { days: 7, label: "7d" },
  { days: 28, label: "28d" },
  { days: 90, label: "90d" }
];

/**
 * Minimal Markdown renderer for report display.
 *
 * Deliberately not a Markdown library: the input is always our own Claude
 * output in a known shape, and pulling in a parser plus a sanitiser for
 * headings, bold, tables and lists would be more surface area than the job
 * needs. Everything is rendered as text nodes, so no HTML from the model can
 * execute.
 */
function Markdown({ source }: { source: string }) {
  const blocks = source.split("\n");
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={key} className="ml-4 grid list-disc gap-1 text-[13px] leading-6 text-ink-700">
        {listBuffer.map((item, index) => (
          <li key={index}>{inline(item.replace(/^[-*]\s+/, ""))}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  const flushTable = (key: string) => {
    if (tableBuffer.length === 0) return;
    const rows = tableBuffer
      .filter((line) => !/^\|[\s:|-]+\|$/.test(line))
      .map((line) =>
        line
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim())
      );
    const [header, ...body] = rows;

    nodes.push(
      <div key={key} className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-500">
              {header?.map((cell, index) => (
                <th key={index} className="py-2 pr-3 font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-hairline/60 last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="tabular py-2 pr-3 text-ink-700">
                    {inline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableBuffer = [];
  };

  function inline(text: string): React.ReactNode {
    // Only bold is handled; the model is instructed to write plain prose.
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={index} className="font-semibold text-ink-900">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={index}>{part}</span>
      )
    );
  }

  blocks.forEach((line, index) => {
    const key = `n${index}`;

    if (line.trim().startsWith("|")) {
      flushList(`${key}-l`);
      tableBuffer.push(line.trim());
      return;
    }
    flushTable(`${key}-t`);

    if (/^[-*]\s+/.test(line.trim())) {
      listBuffer.push(line.trim());
      return;
    }
    flushList(`${key}-l`);

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      nodes.push(
        level <= 1 ? (
          <h2 key={key} className="font-display text-xl text-ink-900">{inline(text)}</h2>
        ) : level === 2 ? (
          <h3 key={key} className="mt-2 font-display text-base font-semibold text-ink-900">{inline(text)}</h3>
        ) : (
          <h4 key={key} className="text-[13px] font-semibold text-ink-800">{inline(text)}</h4>
        )
      );
      return;
    }

    if (line.trim() === "") {
      return;
    }

    nodes.push(
      <p key={key} className="text-[13px] leading-6 text-ink-700">
        {inline(line)}
      </p>
    );
  });

  flushList("tail-l");
  flushTable("tail-t");

  return <div className="grid gap-3">{nodes}</div>;
}

function ReportViewer({ insightId }: { insightId: string }) {
  const detail = useQuery({
    queryKey: ["insight", insightId],
    queryFn: () => api.getInsight(insightId)
  });

  if (detail.isLoading) {
    return <p className="text-sm text-ink-500">Loading report…</p>;
  }

  const data = detail.data;
  if (!data) return null;

  if (!data.markdown) {
    return (
      <p className="rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
        {data.record.errorMessage ??
          "This report has no output yet. The prompt was saved to the client folder and can be run manually."}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigator.clipboard.writeText(data.markdown ?? "")}
        >
          Copy Markdown
        </Button>
        <span className="text-[12px] text-ink-500">
          Saved to <span className="font-mono">{data.record.outputPath}</span>
        </span>
      </div>
      <div className="rounded-[var(--radius-md)] border border-hairline bg-white p-5">
        <Markdown source={data.markdown} />
      </div>
    </div>
  );
}

export function InsightsPage() {
  const { clientId = "" } = useParams();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(28);
  const [openId, setOpenId] = useState<string | null>(null);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api.getClient(clientId),
    enabled: Boolean(clientId)
  });

  const claude = useQuery({ queryKey: ["claude-status"], queryFn: api.getClaudeStatus });

  const insights = useQuery({
    queryKey: ["insights", clientId],
    queryFn: () => api.listInsights(clientId),
    // Poll while a report is being written; generation takes about a minute.
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "running") ? 4000 : false)
  });

  const generate = useMutation({
    mutationFn: () => api.generateInsight(clientId, days),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["insights", clientId] });
    }
  });

  const running = insights.data?.some((record) => record.status === "running") ?? false;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <Link className="text-[13px] text-brand-700 hover:underline" to={`/clients/${clientId}`}>
            ← {client.data?.name ?? "Client"}
          </Link>
          <h1 className="font-display text-2xl text-ink-900">Insight reports</h1>
        </div>
      </div>

      <Surface>
        <SurfaceHeader
          eyebrow="Written by Claude, from your own data"
          title="Generate a report"
          description="Every figure is computed from Search Console data before Claude sees it. The model interprets the numbers; it never calculates them."
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

        {claude.data && !claude.data.available ? (
          <p className="rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            {claude.data.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={running || !claude.data?.available}
            loading={generate.isPending || running}
            onClick={() => generate.mutate()}
          >
            {running ? "Writing…" : `Generate ${days}-day report`}
          </Button>
          {running ? <StatusPill tone="warn">Takes about a minute</StatusPill> : null}
        </div>

        {generate.isError ? (
          <p className="text-[13px] text-rose-700">{(generate.error as Error).message}</p>
        ) : null}
      </Surface>

      <Surface>
        <SurfaceHeader title="Reports" />

        {insights.data && insights.data.length === 0 ? (
          <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-ink-300 px-4 py-8 text-center">
            <p className="text-sm font-medium text-ink-700">No reports yet</p>
            <p className="text-[13px] text-ink-500">Generate one above.</p>
          </div>
        ) : null}

        <div className="grid gap-2">
          {(insights.data ?? []).map((record: InsightRecord) => (
            <div key={record.id} className="grid gap-3 rounded-[var(--radius-md)] border border-hairline p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="grid gap-0.5">
                  <span className="text-sm font-medium text-ink-800">
                    {record.periodStart} → {record.periodEnd}
                  </span>
                  <span className="text-[12px] text-ink-500">
                    {record.kind} · {formatRelativeTime(record.completedAt ?? record.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {record.status === "completed" ? (
                    <StatusPill tone="good">Ready</StatusPill>
                  ) : record.status === "running" ? (
                    <StatusPill tone="warn">Writing</StatusPill>
                  ) : record.status === "manual-input-required" ? (
                    <StatusPill tone="warn">Needs manual run</StatusPill>
                  ) : (
                    <StatusPill tone="bad">{record.status}</StatusPill>
                  )}
                  {record.status === "completed" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpenId(openId === record.id ? null : record.id)}
                    >
                      {openId === record.id ? "Hide" : "Read"}
                    </Button>
                  ) : null}
                </div>
              </div>

              {record.errorMessage ? (
                <p className="text-[12px] text-rose-700">{record.errorMessage}</p>
              ) : null}

              {openId === record.id ? <ReportViewer insightId={record.id} /> : null}
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
}
