/**
 * The sweep figure: hand-built SVG, no chart library.
 *
 * Padding is in real pixels rather than percentages so that axis labels keep
 * their authored size whatever the width — a chart that scales its own type is
 * one whose smallest label eventually becomes unreadable.
 *
 * The decision line is part of the figure, not an annotation on it. A curve of
 * error rates means nothing without the threshold it has to stay under, and the
 * crossing is the answer the screen exists to give, so it is computed and
 * marked rather than left to be eyeballed.
 */

import { forwardRef } from "react";

import { clamp } from "../lib/physics";

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
  width: number;
  /** Null for a point that was not measured; the line breaks rather than lying. */
  values: (number | null)[];
}

export interface LineChartProps {
  xs: number[];
  series: SeriesSpec[];
  xDomain: [number, number];
  yMax: number;
  yTicks: number[];
  formatY: (value: number) => string;
  formatX: (value: number) => string;
  rule: { value: number; label: string };
  /** Where the leading series crosses the rule, if it does inside the range. */
  crossing: number | null;
  formatCrossing: (value: number) => string;
  xTitle: string;
  yTitle: string;
  width: number;
  /** Tints the accepting half of the plot, faintly. */
  acceptFill: string;
}

const HEIGHT = 400;
const PAD = { l: 62, r: 20, t: 18, b: 46 };

export const LineChart = forwardRef<SVGSVGElement, LineChartProps>(function LineChart(
  {
    xs,
    series,
    xDomain,
    yMax,
    yTicks,
    formatY,
    formatX,
    rule,
    crossing,
    formatCrossing,
    xTitle,
    yTitle,
    width,
    acceptFill,
  },
  ref,
) {
  const x0 = PAD.l;
  const x1 = width - PAD.r;
  const y0 = PAD.t;
  const y1 = HEIGHT - PAD.b;

  const [lo, hi] = xDomain;
  const sx = (value: number) => x0 + (hi === lo ? 0 : (value - lo) / (hi - lo)) * (x1 - x0);
  const sy = (value: number) => y1 - clamp(value / yMax, 0, 1) * (y1 - y0);

  const xTicks = Array.from({ length: 6 }, (_, index) => lo + ((hi - lo) * index) / 5);
  const ruleY = sy(rule.value);
  const crossX = crossing === null ? 0 : sx(crossing);

  /**
   * A path, broken wherever a point is missing.
   *
   * Bridging a gap would draw a straight segment through values nobody
   * measured, which on a curve of physical quantities is a claim.
   */
  const pathOf = (values: (number | null)[]) => {
    let path = "";
    let area = "";
    let penDown = false;
    let runStart: number | null = null;
    values.forEach((value, index) => {
      const x = xs[index];
      if (value === null || x === undefined) {
        if (penDown && runStart !== null) {
          area += ` L ${sx(xs[index - 1]!).toFixed(1)} ${y1.toFixed(1)} L ${sx(runStart).toFixed(1)} ${y1.toFixed(1)} Z`;
        }
        penDown = false;
        runStart = null;
        return;
      }
      const command = penDown ? "L" : "M";
      if (!penDown) {
        runStart = x;
        area += `${area ? " " : ""}M ${sx(x).toFixed(1)} ${sy(value).toFixed(1)}`;
      } else {
        area += ` L ${sx(x).toFixed(1)} ${sy(value).toFixed(1)}`;
      }
      path += `${path ? " " : ""}${command} ${sx(x).toFixed(1)} ${sy(value).toFixed(1)}`;
      penDown = true;
    });
    if (penDown && runStart !== null) {
      const lastX = xs[values.length - 1] ?? runStart;
      area += ` L ${sx(lastX).toFixed(1)} ${y1.toFixed(1)} L ${sx(runStart).toFixed(1)} ${y1.toFixed(1)} Z`;
    }
    return { path, area };
  };

  const leading = series[series.length - 1];
  const marker = (() => {
    if (!leading) return null;
    for (let index = leading.values.length - 1; index >= 0; index--) {
      const value = leading.values[index];
      const x = xs[index];
      if (value !== null && value !== undefined && x !== undefined) {
        return { x: sx(x), y: sy(value) };
      }
    }
    return null;
  })();

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: HEIGHT,
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--plot)",
        overflow: "hidden",
      }}
    >
      <svg ref={ref} width={width} height={HEIGHT} style={{ display: "block" }}>
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={acceptFill} opacity={0.06} />

        {yTicks.map((tick) => (
          <line key={`gy-${tick}`} x1={x0} y1={sy(tick)} x2={x1} y2={sy(tick)} stroke="var(--line)" strokeWidth={1} />
        ))}
        {xTicks.map((tick) => (
          <line key={`gx-${tick}`} x1={sx(tick)} y1={y0} x2={sx(tick)} y2={y1} stroke="var(--line)" strokeWidth={1} />
        ))}

        <line x1={x0} y1={ruleY} x2={x1} y2={ruleY} stroke="var(--red)" strokeWidth={1.6} strokeDasharray="6 4" />
        {crossing !== null && (
          <line x1={crossX} y1={y0} x2={crossX} y2={y1} stroke="var(--red)" strokeWidth={1} strokeDasharray="3 4" opacity={0.7} />
        )}

        {series.map((entry) => {
          const { path, area } = pathOf(entry.values);
          return (
            <g key={entry.key}>
              <path d={area} fill={entry.color} opacity={0.09} />
              <path
                d={path}
                fill="none"
                stroke={entry.color}
                strokeWidth={entry.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* The leading point, so a sweep in flight shows where it has got to. */}
        {marker && <circle cx={marker.x} cy={marker.y} r={4.5} fill={leading!.color} stroke="var(--plot)" strokeWidth={1.2} />}

        <line x1={x0} y1={y1} x2={x1} y2={y1} stroke="var(--line-2)" strokeWidth={1} />
        <line x1={x0} y1={y0} x2={x0} y2={y1} stroke="var(--line-2)" strokeWidth={1} />
      </svg>

      {yTicks.map((tick) => (
        <span
          key={`ly-${tick}`}
          className="mono"
          style={{
            position: "absolute",
            right: width - x0 + 8,
            top: sy(tick) - 7,
            fontSize: 10.5,
            color: "var(--fg-3)",
            whiteSpace: "nowrap",
          }}
        >
          {formatY(tick)}
        </span>
      ))}
      {xTicks.map((tick, index) => (
        <span
          key={`lx-${index}`}
          className="mono"
          style={{
            position: "absolute",
            left: sx(tick),
            top: y1 + 8,
            transform: `translateX(${index === 0 ? "0" : index === 5 ? "-100%" : "-50%"})`,
            fontSize: 10.5,
            color: "var(--fg-3)",
            whiteSpace: "nowrap",
          }}
        >
          {formatX(tick)}
        </span>
      ))}

      <span
        className="mono"
        style={{ position: "absolute", right: 10, top: ruleY - 18, fontSize: 10.5, color: "var(--red)" }}
      >
        {rule.label}
      </span>

      {crossing !== null && (
        <span
          className="mono"
          style={{
            position: "absolute",
            left: clamp(crossX, x0 + 4, x1 - 70),
            top: y0 + 6,
            padding: "2px 7px",
            borderRadius: 6,
            border: "1px solid color-mix(in oklab, var(--red) 40%, transparent)",
            background: "color-mix(in oklab, var(--red) 14%, var(--panel))",
            fontSize: 10.5,
            color: "var(--red)",
            whiteSpace: "nowrap",
          }}
        >
          {formatCrossing(crossing)}
        </span>
      )}

      <span
        style={{
          position: "absolute",
          left: 6,
          top: "50%",
          transform: "rotate(-90deg) translateX(-50%)",
          transformOrigin: "left center",
          fontSize: 10.5,
          color: "var(--fg-3)",
          whiteSpace: "nowrap",
        }}
      >
        {yTitle}
      </span>
      <span
        style={{
          position: "absolute",
          left: (x0 + x1) / 2,
          bottom: 6,
          transform: "translateX(-50%)",
          fontSize: 10.5,
          color: "var(--fg-3)",
          whiteSpace: "nowrap",
        }}
      >
        {xTitle}
      </span>
    </div>
  );
});
