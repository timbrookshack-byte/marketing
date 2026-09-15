"use client";

import { useId, useMemo, useState } from "react";
import { formatCompactCurrency, formatDateShort, formatNumber, safeDiv } from "@/lib/util";

/**
 * Hand-rolled SVG charts.
 *
 * Rules held to throughout: one y-axis per chart (never two scales on one
 * plot), colour assigned to an entity rather than to its rank so filtering
 * never repaints the survivors, thin marks over hairline grids, a legend
 * whenever there is more than one series, and a hover layer on everything that
 * plots data.
 */

const AXIS_COLOR = "var(--axis)";
const GRID_COLOR = "var(--grid)";
const MUTED = "var(--text-muted)";

interface Point {
  date: string;
  [key: string]: string | number;
}

/**
 * Rounds an axis maximum up to a readable number.
 *
 * The step list is deliberately fine-grained: with only 1/2/5/10 available, a
 * peak of 9.9K rounds to 20K and the data ends up using half the plot height.
 */
const NICE_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = NICE_STEPS.find((candidate) => normalised <= candidate) ?? 10;
  return step * magnitude;
}

// ------------------------------------------------------------- time series

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export function TimeSeriesChart({
  data,
  series,
  height = 240,
  valueFormat = "currency",
  currency = "USD",
  title,
}: {
  data: Point[];
  series: SeriesSpec[];
  height?: number;
  valueFormat?: "currency" | "number";
  currency?: string;
  title?: string;
}) {
  const clipId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 760;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const { max, xFor, yFor, ticks } = useMemo(() => {
    const values = data.flatMap((row) => series.map((s) => Number(row[s.key] ?? 0)));
    const rawMax = Math.max(1, ...values);
    const max = niceCeil(rawMax * 1.1);
    const xFor = (index: number) =>
      padding.left + (data.length <= 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
    const yFor = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => max * fraction);
    return { max, xFor, yFor, ticks };
  }, [data, series, plotWidth, plotHeight, padding.left, padding.top]);

  const format = (value: number) =>
    valueFormat === "currency" ? formatCompactCurrency(value, currency) : formatNumber(value);

  if (data.length === 0) {
    return <EmptyPlot height={height} message="No data in this window yet." />;
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <figure className="m-0">
      {title ? (
        <figcaption className="mb-3 text-[13px] font-medium text-[var(--text-secondary)]">
          {title}
        </figcaption>
      ) : null}

      {/* A legend is always present for two or more series, so identity is never
          carried by colour alone. */}
      {series.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ height }}
          role="img"
          aria-label={title ?? "Time series"}
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = ((event.clientX - rect.left) / rect.width) * width;
            const fraction = (relativeX - padding.left) / plotWidth;
            const index = Math.round(fraction * (data.length - 1));
            setHoverIndex(Math.max(0, Math.min(data.length - 1, index)));
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight} />
            </clipPath>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yFor(tick)}
                y2={yFor(tick)}
                stroke={tick === 0 ? AXIS_COLOR : GRID_COLOR}
                strokeWidth={1}
              />
              <text x={padding.left - 8} y={yFor(tick) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
                {format(tick)}
              </text>
            </g>
          ))}

          {/* x labels: first, middle and last only — a label on every day is noise. */}
          {[0, Math.floor(data.length / 2), data.length - 1]
            .filter((index, position, all) => all.indexOf(index) === position)
            .map((index) => (
              <text
                key={index}
                x={xFor(index)}
                y={height - 8}
                textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}
                fontSize={11}
                fill={MUTED}
              >
                {formatDateShort(data[index].date)}
              </text>
            ))}

          <g clipPath={`url(#${clipId})`}>
            {series.map((s) => {
              const path = data
                .map((row, index) => `${index === 0 ? "M" : "L"}${xFor(index)},${yFor(Number(row[s.key] ?? 0))}`)
                .join(" ");
              return (
                <path
                  key={s.key}
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}
          </g>

          {hoverIndex !== null ? (
            <g>
              <line
                x1={xFor(hoverIndex)}
                x2={xFor(hoverIndex)}
                y1={padding.top}
                y2={padding.top + plotHeight}
                stroke={AXIS_COLOR}
                strokeWidth={1}
              />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={xFor(hoverIndex)}
                  cy={yFor(Number(data[hoverIndex][s.key] ?? 0))}
                  r={4}
                  fill={s.color}
                  // A 2px surface ring keeps overlapping marks readable.
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
        </svg>

        {hovered ? (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border px-3 py-2 text-[12px] shadow-sm hairline"
            style={{
              background: "var(--surface-1)",
              left: `${Math.min(75, Math.max(2, ((xFor(hoverIndex!) - padding.left) / plotWidth) * 100))}%`,
            }}
          >
            <div className="mb-1 font-medium">{formatDateShort(hovered.date)}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-2 whitespace-nowrap">
                <span
                  aria-hidden
                  className="inline-block h-[2px] w-3 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="text-[var(--text-secondary)]">{s.label}</span>
                <span className="tnum ml-auto font-medium">{format(Number(hovered[s.key] ?? 0))}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

// ------------------------------------------------------------ channel bars

export interface BarDatum {
  label: string;
  value: number;
  color: string;
  secondary?: string;
}

export function ChannelBars({
  data,
  currency = "USD",
  title,
  valueFormat = "currency",
}: {
  data: BarDatum[];
  currency?: string;
  title?: string;
  valueFormat?: "currency" | "number";
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const format = (value: number) =>
    valueFormat === "currency" ? formatCompactCurrency(value, currency) : formatNumber(value, 2);

  if (data.length === 0) return <EmptyPlot height={140} message="Nothing to compare yet." />;

  return (
    <figure className="m-0">
      {title ? (
        <figcaption className="mb-3 text-[13px] font-medium text-[var(--text-secondary)]">
          {title}
        </figcaption>
      ) : null}
      <div className="flex flex-col gap-2.5">
        {data.map((datum) => (
          <div
            key={datum.label}
            className="grid grid-cols-[minmax(92px,auto)_1fr_auto] items-center gap-3"
            onMouseEnter={() => setHover(datum.label)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-[12px] text-[var(--text-secondary)]">{datum.label}</span>
            <span className="relative block h-[10px] rounded-full" style={{ background: "var(--surface-sunken)" }}>
              <span
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                style={{
                  width: `${Math.max(1.5, (datum.value / max) * 100)}%`,
                  background: datum.color,
                  opacity: hover && hover !== datum.label ? 0.45 : 1,
                }}
              />
            </span>
            <span className="tnum text-[12px] font-medium">
              {format(datum.value)}
              {datum.secondary ? (
                <span className="ml-2 font-normal text-[var(--text-muted)]">{datum.secondary}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

// ------------------------------------------------------- efficiency scatter

export interface ScatterDatum {
  label: string;
  x: number;
  y: number;
  size: number;
  status?: "good" | "warning" | "critical" | "neutral";
}

/**
 * Spend against return, one dot per campaign.
 *
 * Every dot is drawn in the same hue: at this many campaigns a colour-per-entity
 * scatter cannot stay distinguishable under colour-vision deficiency, so
 * identity comes from direct labels and hover instead. The reference lines are
 * where the real reading happens — anything below break-even is losing money
 * on every sale.
 */
export function EfficiencyScatter({
  data,
  breakEven,
  target,
  currency = "USD",
  height = 296,
}: {
  data: ScatterDatum[];
  breakEven: number;
  target: number;
  currency?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<ScatterDatum | null>(null);
  const width = 760;
  const padding = { top: 18, right: 20, bottom: 52, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  if (data.length === 0) return <EmptyPlot height={height} message="No campaigns with spend yet." />;

  const maxX = niceCeil(Math.max(...data.map((d) => d.x)) * 1.12);
  const maxY = niceCeil(Math.max(target * 1.3, ...data.map((d) => d.y)) * 1.1);
  const maxSize = Math.max(1, ...data.map((d) => d.size));

  const xFor = (value: number) => padding.left + (value / maxX) * plotWidth;
  const yFor = (value: number) => padding.top + plotHeight - (value / maxY) * plotHeight;
  // Area, not radius, carries magnitude — radius would exaggerate it.
  const rFor = (value: number) => 5 + Math.sqrt(safeDiv(value, maxSize)) * 13;

  const statusColor = (status: ScatterDatum["status"]) =>
    status === "critical"
      ? "var(--status-critical)"
      : status === "warning"
        ? "var(--status-warning)"
        : status === "good"
          ? "var(--status-good)"
          : "var(--series-1)";

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[13px] font-medium text-[var(--text-secondary)]">
        Spend against return, one dot per campaign
      </figcaption>
      <p className="mb-3 text-[12px] text-[var(--text-muted)]">
        Dot size is monthly spend. Anything below the break-even line loses money on every sale.
      </p>
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yFor(maxY * fraction)}
                y2={yFor(maxY * fraction)}
                stroke={fraction === 0 ? AXIS_COLOR : GRID_COLOR}
              />
              <text
                x={padding.left - 8}
                y={yFor(maxY * fraction) + 4}
                textAnchor="end"
                fontSize={11}
                fill={MUTED}
              >
                {(maxY * fraction).toFixed(1)}x
              </text>
            </g>
          ))}

          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={yFor(breakEven)}
            y2={yFor(breakEven)}
            stroke="var(--status-critical)"
            strokeWidth={1.5}
          />
          <text x={width - padding.right} y={yFor(breakEven) - 6} textAnchor="end" fontSize={11} fill="var(--status-critical)">
            break-even {breakEven.toFixed(2)}x
          </text>

          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={yFor(target)}
            y2={yFor(target)}
            stroke="var(--status-good)"
            strokeWidth={1.5}
          />
          <text x={width - padding.right} y={yFor(target) - 6} textAnchor="end" fontSize={11} fill="var(--status-good)">
            target {target.toFixed(1)}x
          </text>

          {data.map((datum) => (
            <g key={datum.label}>
              <circle
                cx={xFor(datum.x)}
                cy={yFor(datum.y)}
                r={rFor(datum.size)}
                fill={statusColor(datum.status)}
                fillOpacity={hover && hover.label !== datum.label ? 0.25 : 0.55}
                stroke="var(--surface-1)"
                strokeWidth={2}
                onMouseEnter={() => setHover(datum)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          ))}

          {/* x ticks: without values the horizontal position carries no meaning. */}
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <text
              key={fraction}
              x={xFor(maxX * fraction)}
              y={height - 20}
              textAnchor="middle"
              fontSize={11}
              fill={MUTED}
            >
              {formatCompactCurrency(maxX * fraction, currency)}
            </text>
          ))}
          <text
            x={padding.left + plotWidth / 2}
            y={height - 5}
            textAnchor="middle"
            fontSize={11}
            fill={MUTED}
          >
            Spend in window →
          </text>
        </svg>

        {hover ? (
          <div
            className="pointer-events-none absolute rounded-lg border px-3 py-2 text-[12px] shadow-sm hairline"
            style={{
              background: "var(--surface-1)",
              left: `${Math.min(70, ((xFor(hover.x) - padding.left) / plotWidth) * 100)}%`,
              top: `${Math.max(0, ((yFor(hover.y) - padding.top) / plotHeight) * 100 - 12)}%`,
            }}
          >
            <div className="font-medium">{hover.label}</div>
            <div className="tnum text-[var(--text-secondary)]">
              {formatCompactCurrency(hover.x, currency)} spend · {hover.y.toFixed(2)}x return
            </div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

// ------------------------------------------------------------------ sparkline

export function Sparkline({
  values,
  color = "var(--series-1)",
  width = 96,
  height = 26,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="text-[var(--text-muted)]">—</span>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function EmptyPlot({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed text-[13px] text-[var(--text-muted)] hairline"
      style={{ height }}
    >
      {message}
    </div>
  );
}
