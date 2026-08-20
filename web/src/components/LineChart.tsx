/**
 * The sweep figure: hand-built SVG, no chart library.
 *
 * EVERYTHING THAT IS PART OF THE FIGURE IS INSIDE THE SVG — title, legend, tick
 * labels, axis titles, the decision rule and its crossing. That is not a
 * stylistic preference. These charts are exported and dropped into a report,
 * and an export serialises the SVG element and nothing else: labels laid over
 * it as absolutely-positioned HTML looked right on screen and came out as bare
 * coloured lines on a blank field, with no numbers to read them against.
 *
 * The one thing deliberately left outside is the hover tooltip, which belongs
 * to reading the chart rather than to the chart, and would be a frozen artefact
 * in a saved figure.
 *
 * Padding is in real pixels rather than percentages so labels keep their
 * authored size whatever the width — a chart that scales its own type is one
 * whose smallest label eventually becomes unreadable.
 */

import { forwardRef, useState } from "react";

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
  /** A second reading of the same axis, printed under the first. */
  formatX2?: (value: number) => string;
  rule: { value: number; label: string };
  /** Where the leading series crosses the rule, if it does inside the range. */
  crossing: number | null;
  formatCrossing: (value: number) => string;
  xTitle: string;
  yTitle: string;
  /** What the figure is, for the exported copy that arrives without context. */
  title: string;
  subtitle: string;
  /** What a point is called, so the tooltip can name it: "run 7". */
  runLabel: string;
  width: number;
  /** Tints the accepting half of the plot, faintly. */
  acceptFill: string;
}

const HEIGHT = 500;
/**
 * Room for the title, subtitle and legend above, and two rows of tick labels
 * plus the axis title below.
 *
 * Generous on purpose. Everything that used to float over the chart as HTML now
 * lives inside it, and packed against the plot it read as clutter rather than
 * as a figure — the labels need to be clearly outside the data, not crowding it.
 */
const PAD = { l: 88, r: 34, t: 104, b: 84 };

const MONO = "ui-monospace, 'SF Mono', monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

export const LineChart = forwardRef<SVGSVGElement, LineChartProps>(function LineChart(
  {
    xs,
    series,
    xDomain,
    yMax,
    yTicks,
    formatY,
    formatX,
    formatX2,
    rule,
    crossing,
    formatCrossing,
    xTitle,
    yTitle,
    title,
    subtitle,
    runLabel,
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
   * The point under the pointer.
   *
   * A curve says how something behaves; reading a value off it by eye against
   * two axes is guesswork. The nearest sample is snapped to rather than
   * interpolated, because every point here is a real run and inventing a value
   * between two of them would be inventing a run.
   */
  const [hover, setHover] = useState<number | null>(null);

  const nearest = (clientX: number, box: DOMRect): number | null => {
    if (!xs.length) return null;
    // Relative to the overlay, which already starts at the plot's left edge.
    const px = clientX - box.left;
    const value = lo + (px / (x1 - x0)) * (hi - lo);
    let best = 0;
    for (let index = 1; index < xs.length; index++) {
      if (Math.abs(xs[index]! - value) < Math.abs(xs[best]! - value)) best = index;
    }
    return best;
  };

  const hovered =
    hover !== null && xs[hover] !== undefined
      ? {
          index: hover,
          x: sx(xs[hover]!),
          rows: series
            .map((entry) => ({ label: entry.label, color: entry.color, value: entry.values[hover] }))
            .filter(
              (row): row is { label: string; color: string; value: number } =>
                row.value !== null && row.value !== undefined,
            ),
        }
      : null;

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
      if (value === null || value === undefined || x === undefined) {
        if (penDown && runStart !== null) {
          area += ` L ${sx(xs[index - 1]!).toFixed(1)} ${y1.toFixed(1)} L ${sx(runStart).toFixed(1)} ${y1.toFixed(1)} Z`;
        }
        penDown = false;
        runStart = null;
        return;
      }
      if (!penDown) {
        runStart = x;
        area += `${area ? " " : ""}M ${sx(x).toFixed(1)} ${sy(value).toFixed(1)}`;
      } else {
        area += ` L ${sx(x).toFixed(1)} ${sy(value).toFixed(1)}`;
      }
      path += `${path ? " " : ""}${penDown ? "L" : "M"} ${sx(x).toFixed(1)} ${sy(value).toFixed(1)}`;
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

  // Laid out left to right under the title, measured rather than guessed: the
  // swatch, a gap, and enough room for the label at this size.
  const legend = [
    ...series.map((entry) => ({ label: entry.label, color: entry.color, dashed: false })),
    { label: rule.label, color: "var(--red)", dashed: true },
  ];
  let legendX = x0;
  const legendItems = legend.map((entry) => {
    const at = legendX;
    legendX += 20 + entry.label.length * 6.2 + 20;
    return { ...entry, x: at };
  });

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
        {/* Painted, not transparent: an exported PNG dropped into a light
            document would otherwise show the page through the figure. */}
        <rect x={0} y={0} width={width} height={HEIGHT} fill="var(--plot)" />

        <text x={x0} y={34} fill="var(--fg)" fontFamily={SANS} fontSize={16} fontWeight={600}>
          {title}
        </text>
        <text x={x0} y={56} fill="var(--fg-3)" fontFamily={MONO} fontSize={10.5}>
          {subtitle}
        </text>

        {legendItems.map((entry) => (
          <g key={entry.label}>
            {entry.dashed ? (
              <line
                x1={entry.x}
                y1={y0 - 26}
                x2={entry.x + 14}
                y2={y0 - 26}
                stroke={entry.color}
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            ) : (
              <rect x={entry.x} y={y0 - 28} width={14} height={3} rx={1.5} fill={entry.color} />
            )}
            <text
              x={entry.x + 20}
              y={y0 - 22}
              fill="var(--fg-2)"
              fontFamily={SANS}
              fontSize={11.5}
            >
              {entry.label}
            </text>
          </g>
        ))}

        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={acceptFill} opacity={0.06} />

        {yTicks.map((tick) => (
          <line key={`gy-${tick}`} x1={x0} y1={sy(tick)} x2={x1} y2={sy(tick)} stroke="var(--line)" strokeWidth={1} />
        ))}
        {xTicks.map((tick) => (
          <line key={`gx-${tick}`} x1={sx(tick)} y1={y0} x2={sx(tick)} y2={y1} stroke="var(--line)" strokeWidth={1} />
        ))}

        <line x1={x0} y1={ruleY} x2={x1} y2={ruleY} stroke="var(--red)" strokeWidth={1.6} strokeDasharray="6 4" />
        {crossing !== null && (
          <line
            x1={crossX}
            y1={y0}
            x2={crossX}
            y2={y1}
            stroke="var(--red)"
            strokeWidth={1}
            strokeDasharray="3 4"
            opacity={0.7}
          />
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

        {hovered && (
          <g>
            <line x1={hovered.x} y1={y0} x2={hovered.x} y2={y1} stroke="var(--fg-3)" strokeWidth={1} opacity={0.5} />
            {hovered.rows.map((row) => (
              <circle
                key={row.label}
                cx={hovered.x}
                cy={sy(row.value)}
                r={4}
                fill={row.color}
                stroke="var(--plot)"
                strokeWidth={1.5}
              />
            ))}
          </g>
        )}

        {/* The leading point, so a sweep in flight shows where it has got to. */}
        {marker && (
          <circle cx={marker.x} cy={marker.y} r={4.5} fill={leading!.color} stroke="var(--plot)" strokeWidth={1.2} />
        )}

        <line x1={x0} y1={y1} x2={x1} y2={y1} stroke="var(--line-2)" strokeWidth={1} />
        <line x1={x0} y1={y0} x2={x0} y2={y1} stroke="var(--line-2)" strokeWidth={1} />

        {yTicks.map((tick) => (
          <text
            key={`ly-${tick}`}
            x={x0 - 10}
            y={sy(tick) + 3.5}
            textAnchor="end"
            fill="var(--fg-3)"
            fontFamily={MONO}
            fontSize={10.5}
          >
            {formatY(tick)}
          </text>
        ))}

        {xTicks.map((tick, index) => {
          // The first and last labels are pinned to the axis ends instead of
          // being centred, or half of each would sit outside the frame.
          const anchor = index === 0 ? "start" : index === 5 ? "end" : "middle";
          return (
            <g key={`lx-${index}`}>
              <text
                x={sx(tick)}
                y={y1 + 20}
                textAnchor={anchor}
                fill="var(--fg-3)"
                fontFamily={MONO}
                fontSize={10.5}
              >
                {formatX(tick)}
              </text>
              {formatX2 && (
                <text
                  x={sx(tick)}
                  y={y1 + 36}
                  textAnchor={anchor}
                  fill="var(--fg-3)"
                  fontFamily={MONO}
                  fontSize={9.5}
                  opacity={0.75}
                >
                  {formatX2(tick)}
                </text>
              )}
            </g>
          );
        })}

        <text
          x={(x0 + x1) / 2}
          y={HEIGHT - 18}
          textAnchor="middle"
          fill="var(--fg-3)"
          fontFamily={SANS}
          fontSize={11}
        >
          {xTitle}
        </text>
        <text
          transform={`translate(20 ${(y0 + y1) / 2}) rotate(-90)`}
          textAnchor="middle"
          fill="var(--fg-3)"
          fontFamily={SANS}
          fontSize={11}
        >
          {yTitle}
        </text>

        {crossing !== null &&
          (() => {
            const label = formatCrossing(crossing);
            // Measured from the string rather than fixed: the same tag carries
            // "6.5 km" and "6.5 km · γ 0.257", and a box sized for the first
            // spills the second out of its own frame.
            const boxWidth = label.length * 6.4 + 18;
            const left = clamp(crossX + 8, x0 + 4, x1 - boxWidth - 4);
            return (
              <g>
                <rect
                  x={left}
                  y={y0 + 8}
                  width={boxWidth}
                  height={22}
                  rx={6}
                  fill="var(--plot)"
                  stroke="var(--red)"
                  strokeOpacity={0.45}
                />
                <text
                  x={left + boxWidth / 2}
                  y={y0 + 23}
                  textAnchor="middle"
                  fill="var(--red)"
                  fontFamily={MONO}
                  fontSize={10.5}
                >
                  {label}
                </text>
              </g>
            );
          })()}
      </svg>

      {/* Transparent, and only over the plot: a hover target that covered the
          labels would fire when the pointer is nowhere near the data. */}
      <div
        onPointerMove={(event) => setHover(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setHover(null)}
        style={{ position: "absolute", left: x0, top: y0, width: x1 - x0, height: y1 - y0, cursor: "crosshair" }}
      />

      {hovered && hovered.rows.length > 0 && (
        <div
          style={{
            position: "absolute",
            // Flips to the other side near the right edge rather than being
            // clipped by the frame.
            left: hovered.x + (hovered.x > (x0 + x1) / 2 ? -14 : 14),
            top: y0 + 10,
            transform: hovered.x > (x0 + x1) / 2 ? "translateX(-100%)" : "none",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "9px 11px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "color-mix(in oklab, var(--panel) 92%, transparent)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 18px 40px -26px #000, inset 0 1px 0 var(--hi)",
            pointerEvents: "none",
            zIndex: 3,
          }}
        >
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
            {runLabel} {hovered.index + 1} · {formatX(xs[hovered.index]!)}
            {formatX2 && ` · ${formatX2(xs[hovered.index]!)}`}
          </span>
          {hovered.rows.map((row) => (
            <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flex: "none" }} />
              <span style={{ fontSize: 11, color: "var(--fg-2)" }}>{row.label}</span>
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: row.color, marginLeft: "auto" }}>
                {formatY(row.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
