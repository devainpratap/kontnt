import type { PeriodTotals } from "@rankos/shared";

import { UNKNOWN } from "../lib/format";

/**
 * Headline KPIs with a period-over-period delta.
 *
 * Two rules encoded here:
 *   - a null position renders as a dash, never 0. Zero would read as "ranking
 *     first" when it actually means "no impressions in this window".
 *   - for position, *down is good*. The delta arrow and colour are inverted
 *     relative to the other three metrics.
 */

type Metric = {
  key: string;
  label: string;
  value: string;
  delta: number | null;
  /** True when a decrease is an improvement (average position). */
  lowerIsBetter?: boolean;
  hint?: string;
};

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / previous) * 100;
}

function DeltaBadge({ delta, lowerIsBetter }: { delta: number | null; lowerIsBetter?: boolean }) {
  if (delta === null || !Number.isFinite(delta)) {
    // No comparable prior period — say so rather than implying zero change.
    return <span className="text-[12px] text-ink-400">no prior data</span>;
  }

  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) {
    return <span className="text-[12px] text-ink-500">no change</span>;
  }

  const rising = rounded > 0;
  const good = lowerIsBetter ? !rising : rising;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[12px] font-medium ${
        good ? "text-emerald-700" : "text-rose-600"
      }`}
    >
      <span aria-hidden>{rising ? "▲" : "▼"}</span>
      {Math.abs(rounded).toFixed(1)}%
    </span>
  );
}

export function KpiRow({ totals, previous }: { totals: PeriodTotals; previous: PeriodTotals }) {
  const metrics: Metric[] = [
    {
      key: "clicks",
      label: "Clicks",
      value: totals.clicks.toLocaleString(),
      delta: percentDelta(totals.clicks, previous.clicks)
    },
    {
      key: "impressions",
      label: "Impressions",
      value: totals.impressions.toLocaleString(),
      delta: percentDelta(totals.impressions, previous.impressions)
    },
    {
      key: "ctr",
      label: "CTR",
      value: `${(totals.ctr * 100).toFixed(2)}%`,
      delta: percentDelta(totals.ctr, previous.ctr)
    },
    {
      key: "position",
      label: "Avg position",
      value: totals.position === null ? UNKNOWN : totals.position.toFixed(1),
      delta:
        totals.position === null || previous.position === null
          ? null
          : percentDelta(totals.position, previous.position),
      lowerIsBetter: true,
      hint: "Impression-weighted, from Search Console"
    }
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.key} className="grid gap-1 rounded-[var(--radius-md)] border border-hairline bg-white p-4">
          <span className="text-[12px] uppercase tracking-wide text-ink-500">{metric.label}</span>
          <span className="tabular font-display text-2xl leading-tight text-ink-900">{metric.value}</span>
          <DeltaBadge delta={metric.delta} lowerIsBetter={metric.lowerIsBetter} />
          {metric.hint ? <span className="text-[11px] text-ink-400">{metric.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}
