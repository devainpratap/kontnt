import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { PositionPoint } from "@rankos/shared";

/**
 * Tracked position over time.
 *
 * Two decisions carry the meaning of this chart:
 *
 *  - The y-axis is reversed, because position 1 is the good end. A conventional
 *    axis would draw improvement as a falling line.
 *  - Checks that were blocked or errored are drawn as a **gap plus a shaded
 *    band**, never as a value. Plotting them at 0 or 100 would turn a scraper
 *    failure into an apparent ranking collapse, which is the single most
 *    damaging thing this dashboard could show a client.
 */

const SERIES_COLOR = "#2a78d6"; // validated categorical slot 1
const UNKNOWN_FILL = "rgba(100, 116, 139, 0.10)";

type Props = {
  history: PositionPoint[];
  /** Positions past this are off the tracked window; the axis stops here. */
  maxPosition?: number;
};

function formatAxisDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

type ShapedPoint = PositionPoint & { plotted: number | null };

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ShapedPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-hairline bg-white px-3 py-2 text-[12px] shadow-soft">
      <p className="font-medium text-ink-800">{point.date}</p>

      {point.status === "ok" ? (
        <>
          <p className="tabular text-ink-700">Position {point.position}</p>
          {point.rankingUrl ? (
            <p className="max-w-[280px] truncate text-ink-500">{point.rankingUrl}</p>
          ) : null}
        </>
      ) : point.status === "not-found" ? (
        <p className="text-ink-600">Not in the top 100</p>
      ) : point.status === "blocked" ? (
        <p className="text-amber-700">Check blocked — position unknown</p>
      ) : (
        <p className="text-rose-700">Check failed — position unknown</p>
      )}
    </div>
  );
}

export function PositionChart({ history, maxPosition = 100 }: Props) {
  if (history.length === 0) {
    return (
      <div className="grid h-[200px] place-items-center rounded-[var(--radius-md)] border border-dashed border-ink-300">
        <p className="text-[13px] text-ink-500">No rank checks yet for this keyword.</p>
      </div>
    );
  }

  // connectNulls is deliberately off below, so a null leaves a real break in
  // the line rather than a straight segment implying continuity we never saw.
  const shaped: ShapedPoint[] = history.map((point) => ({
    ...point,
    plotted: point.status === "ok" ? point.position : null
  }));

  const known = shaped.filter((point) => point.plotted !== null).map((point) => point.plotted as number);
  const worst = known.length > 0 ? Math.min(Math.max(...known) + 5, maxPosition) : 20;

  // Contiguous runs of unknown checks, shaded so the gap is explained rather
  // than just absent.
  const unknownBands: Array<{ from: string; to: string }> = [];
  let bandStart: string | null = null;

  for (const [index, point] of shaped.entries()) {
    const isUnknown = point.status === "blocked" || point.status === "error";
    if (isUnknown && bandStart === null) {
      bandStart = point.date;
    }
    if ((!isUnknown || index === shaped.length - 1) && bandStart !== null) {
      unknownBands.push({ from: bandStart, to: shaped[isUnknown ? index : Math.max(index - 1, 0)].date });
      bandStart = null;
    }
  }

  return (
    <div className="grid gap-2">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={shaped} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />

          {unknownBands.map((band) => (
            <ReferenceArea
              key={`${band.from}-${band.to}`}
              x1={band.from}
              x2={band.to}
              fill={UNKNOWN_FILL}
              stroke="none"
            />
          ))}

          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(15,23,42,0.10)" }}
            minTickGap={28}
          />
          <YAxis
            // Reversed: position 1 sits at the top, so up means better.
            reversed
            domain={[1, worst]}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            width={34}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(15,23,42,0.18)", strokeWidth: 1 }} />

          <Line
            type="monotone"
            dataKey="plotted"
            stroke={SERIES_COLOR}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 2, stroke: "#ffffff" }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {unknownBands.length > 0 ? (
        <p className="text-[11px] text-ink-500">
          Shaded bands are checks that were blocked or failed. The position was not measured on those days — the line is
          broken rather than drawn through them.
        </p>
      ) : null}
    </div>
  );
}
