/**
 * The envelope, drawn as one figure.
 *
 * SVG rather than a grid of divs, and for the same reason the sweep chart is:
 * these get exported and dropped into a report, and an export serialises the
 * SVG element and nothing else. Axis labels, legend, title and the parameters
 * that produced it all live inside, so the saved file is readable on its own.
 *
 * The colour is the argument. A discarded key is one flat red — there is
 * nothing to grade about a run that was refused. An accepted one runs from mint
 * to orange with the share of the key the eavesdropper holds, so the corner
 * where the protocol says yes while she is halfway in is something the eye
 * finds without being told where to look.
 */

import { forwardRef, useState } from "react";

import { measured } from "../../lib/nullable";
import type { SweepPoint } from "../../api/contract";
import type { Row } from "./useEnvelope";

const CELL = 30;
const GAP = 3;
const PAD = { l: 92, r: 30, t: 96, b: 78 };
const MONO = "ui-monospace, 'SF Mono', monospace";
const SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

/** The largest share an intercept-resend can hand the attacker. */
export const MAX_KNOWLEDGE = 0.5;

export function paint(accepted: boolean, knowledge: number | null): string {
  if (!accepted) return "var(--cell-reject)";
  if (!measured(knowledge)) return "var(--cell-accept)";
  const share = Math.min(1, knowledge / MAX_KNOWLEDGE);
  return `color-mix(in oklab, var(--orange) ${(share * 100).toFixed(0)}%, var(--mint))`;
}

export interface HeatmapProps {
  lengths: number[];
  fractionSteps: number;
  rows: Row[];
  width: number;
  running: boolean;
  title: string;
  subtitle: string;
  xTitle: string;
  yTitle: string;
  legend: { accepted: string; rejected: string; knows: string };
  showKnowledge: boolean;
  labels: { accepted: string; rejected: string; na: string };
}

export const Heatmap = forwardRef<SVGSVGElement, HeatmapProps>(function Heatmap(
  { lengths, fractionSteps, rows, width, running, title, subtitle, xTitle, yTitle, legend, showKnowledge, labels },
  ref,
) {
  const [hover, setHover] = useState<{ x: number; y: number; row: number; column: number } | null>(null);

  const height = PAD.t + lengths.length * (CELL + GAP) + PAD.b;
  const x0 = PAD.l;
  const x1 = width - PAD.r;
  const cellWidth = (x1 - x0 - GAP * (fractionSteps - 1)) / fractionSteps;

  const cellX = (column: number) => x0 + column * (cellWidth + GAP);
  const cellY = (row: number) => PAD.t + row * (CELL + GAP);

  const at = (row: number, column: number): SweepPoint | undefined =>
    rows.find((candidate) => candidate.km === lengths[row])?.points[column];

  const hovered = hover ? at(hover.row, hover.column) : undefined;

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    const column = Math.floor((px - x0) / (cellWidth + GAP));
    const row = Math.floor((py - PAD.t) / (CELL + GAP));
    if (column < 0 || column >= fractionSteps || row < 0 || row >= lengths.length) {
      setHover(null);
      return;
    }
    setHover({ x: px, y: py, row, column });
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--plot)",
        overflow: "hidden",
      }}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg ref={ref} width={width} height={height} style={{ display: "block" }}>
        {/* Painted, not transparent: an exported PNG dropped into a light
            document would otherwise show the page through the figure. */}
        <rect x={0} y={0} width={width} height={height} fill="var(--plot)" />

        <text x={x0} y={34} fill="var(--fg)" fontFamily={SANS} fontSize={16} fontWeight={600}>
          {title}
        </text>
        <text x={x0} y={56} fill="var(--fg-3)" fontFamily={MONO} fontSize={10.5}>
          {subtitle}
        </text>

        <g>
          <rect x={x0} y={PAD.t - 30} width={14} height={12} rx={3} fill={paint(true, 0)} />
          <text x={x0 + 20} y={PAD.t - 20} fill="var(--fg-2)" fontFamily={SANS} fontSize={11.5}>
            {legend.accepted}
          </text>
          <rect x={x0 + 150} y={PAD.t - 30} width={14} height={12} rx={3} fill={paint(false, null)} />
          <text x={x0 + 170} y={PAD.t - 20} fill="var(--fg-2)" fontFamily={SANS} fontSize={11.5}>
            {legend.rejected}
          </text>
          {showKnowledge && (
            <>
              <defs>
                <linearGradient id="qkd-knows" x1="0" x2="1">
                  <stop offset="0%" stopColor="var(--mint)" />
                  <stop offset="100%" stopColor="var(--orange)" />
                </linearGradient>
              </defs>
              <rect x={x0 + 300} y={PAD.t - 30} width={90} height={12} rx={3} fill="url(#qkd-knows)" />
              <text x={x0 + 398} y={PAD.t - 20} fill="var(--fg-2)" fontFamily={SANS} fontSize={11.5}>
                {legend.knows}
              </text>
            </>
          )}
        </g>

        {lengths.map((km, row) => (
          <text
            key={`y-${km}`}
            x={x0 - 12}
            y={cellY(row) + CELL / 2 + 3.5}
            textAnchor="end"
            fill="var(--fg-3)"
            fontFamily={MONO}
            fontSize={10.5}
          >
            {km.toFixed(1)} km
          </text>
        ))}

        {lengths.map((km, row) =>
          Array.from({ length: fractionSteps }, (_, column) => {
            const point = at(row, column);
            const focused = hover?.row === row && hover.column === column;
            return (
              <rect
                key={`${km}-${column}`}
                x={cellX(column)}
                y={cellY(row)}
                width={cellWidth}
                height={CELL}
                rx={4}
                fill={point ? paint(point.accepted, point.eavesdropper_knowledge) : "var(--seg)"}
                opacity={point ? 1 : running ? 0.55 : 0.3}
                stroke={focused ? "var(--fg)" : "none"}
                strokeWidth={1}
                style={point ? { animation: "qfade .22s ease both" } : undefined}
              />
            );
          }),
        )}

        {Array.from({ length: fractionSteps }, (_, column) => (
          <text
            key={`x-${column}`}
            x={cellX(column) + cellWidth / 2}
            y={cellY(lengths.length) + 16}
            textAnchor="middle"
            fill="var(--fg-3)"
            fontFamily={MONO}
            fontSize={10}
          >
            {((column / (fractionSteps - 1)) * 100).toFixed(0)} %
          </text>
        ))}

        <text
          x={(x0 + x1) / 2}
          y={height - 18}
          textAnchor="middle"
          fill="var(--fg-3)"
          fontFamily={SANS}
          fontSize={11}
        >
          {xTitle}
        </text>
        <text
          transform={`translate(20 ${PAD.t + (lengths.length * (CELL + GAP)) / 2}) rotate(-90)`}
          textAnchor="middle"
          fill="var(--fg-3)"
          fontFamily={SANS}
          fontSize={11}
        >
          {yTitle}
        </text>
      </svg>

      {/* Follows the pointer instead of living in a fixed panel: on a grid the
          eye is already at the cell, and a readout elsewhere makes it travel. */}
      {hover && hovered && (
        <div
          className="mono"
          style={{
            position: "absolute",
            left: hover.x + (hover.x > width * 0.6 ? -14 : 14),
            top: hover.y + 14,
            transform: hover.x > width * 0.6 ? "translateX(-100%)" : "none",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "9px 11px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "color-mix(in oklab, var(--panel) 94%, transparent)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 18px 40px -26px #000, inset 0 1px 0 var(--hi)",
            pointerEvents: "none",
            zIndex: 3,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: 10, color: "var(--fg-3)" }}>
            {lengths[hover.row]!.toFixed(1)} km · {(hovered.value * 100).toFixed(0)} %
          </span>
          <span
            style={{ fontSize: 12.5, fontWeight: 600, color: hovered.accepted ? "var(--mint)" : "var(--red)" }}
          >
            {hovered.accepted ? labels.accepted : labels.rejected}
          </span>
          <span style={{ fontSize: 11, color: "var(--fg-2)" }}>QBER {(hovered.qber * 100).toFixed(2)} %</span>
          {measured(hovered.chsh) && (
            <span style={{ fontSize: 11, color: "var(--fg-2)" }}>S {hovered.chsh.toFixed(3)}</span>
          )}
          <span style={{ fontSize: 11, color: "var(--orange)" }}>
            Eve{" "}
            {measured(hovered.eavesdropper_knowledge)
              ? `${(hovered.eavesdropper_knowledge * 100).toFixed(0)} %`
              : labels.na}
          </span>
        </div>
      )}
    </div>
  );
});
