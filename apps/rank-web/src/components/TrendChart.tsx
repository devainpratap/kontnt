import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DailyPoint } from "@rankos/shared";

/**
 * One measure, one axis.
 *
 * Clicks and impressions differ by an order of magnitude, so they are rendered
 * as separate stacked charts sharing an x-range rather than a dual-axis plot.
 * Two y-scales on one plot invent a correlation the data does not contain.
 *
 * Provisional days (the ones Google is still revising) are drawn as a separate
 * dashed overlay, so the inevitable dip at the right edge reads as "not settled
 * yet" instead of "traffic collapsed".
 */

type Props = {
  data: DailyPoint[];
  metric: "clicks" | "impressions";
  label: string;
  color: string;
};

function formatAxisDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

type TooltipEntry = { payload?: DailyPoint };

function ChartTooltip({
  active,
  payload,
  metric,
  label
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  metric: Props["metric"];
  label: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-hairline bg-white px-3 py-2 text-[12px] shadow-soft">
      <p className="font-medium text-ink-800">{point.date}</p>
      <p className="tabular text-ink-600">
        {label}: {point[metric].toLocaleString()}
      </p>
      <p className="tabular text-ink-500">Avg position: {point.position.toFixed(1)}</p>
      {point.provisional ? (
        <p className="mt-1 text-[11px] text-amber-700">Provisional — Google is still revising this day</p>
      ) : null}
    </div>
  );
}

export function TrendChart({ data, metric, label, color }: Props) {
  if (data.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center rounded-[var(--radius-md)] border border-dashed border-ink-300">
        <p className="text-[13px] text-ink-500">No Search Console data for this window yet.</p>
      </div>
    );
  }

  const firstProvisionalIndex = data.findIndex((point) => point.provisional);

  // Two series over the same axis: settled days solid, provisional days dashed.
  // They overlap by one point so the line has no visual break at the seam.
  const shaped = data.map((point, index) => ({
    ...point,
    settled: point.provisional ? null : point[metric],
    provisionalValue:
      point.provisional || (firstProvisionalIndex > 0 && index === firstProvisionalIndex - 1)
        ? point[metric]
        : null
  }));

  const gradientId = `fill-${metric}`;

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-medium text-ink-700">{label}</h3>
        {firstProvisionalIndex >= 0 ? (
          <span className="text-[11px] text-ink-500">Dashed = still being revised by Google</span>
        ) : null}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={shaped} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          {/* Recessive grid: horizontal only, so it guides the eye without competing. */}
          <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(15,23,42,0.10)" }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={formatCompact}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            content={<ChartTooltip metric={metric} label={label} />}
            cursor={{ stroke: "rgba(15,23,42,0.18)", strokeWidth: 1 }}
          />

          <Area
            type="monotone"
            dataKey="settled"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
          />
          <Area
            type="monotone"
            dataKey="provisionalValue"
            stroke={color}
            strokeWidth={2}
            strokeDasharray="4 3"
            fill="none"
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
