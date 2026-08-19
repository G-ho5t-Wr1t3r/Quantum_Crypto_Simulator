/**
 * What the run produced: the readouts, the chart, and the per-position trace.
 *
 * Every number here comes from the engine. Nothing is recomputed client-side,
 * because a second implementation of the physics is a second thing that can be
 * wrong — and the one on screen would be the one nobody tested.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { BarChart } from "../../components/BarChart";
import { Kicker } from "../../components/controls";
import { exportUrl } from "../../api/client";
import type { RunResult, TrialResult, Views } from "../../api/contract";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { measured, showPercent } from "../../lib/nullable";
import { TSIRELSON } from "../../lib/physics";

const CARD_NUMBER = {
  fontSize: 23,
  fontWeight: 500,
  letterSpacing: "-.02em",
} as const;

function Card({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  /** Absent for a value that was never measured, which prints greyed. */
  color?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: "14px 15px",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        boxShadow: "inset 0 1px 0 var(--hi)",
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "var(--fg-2)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{ ...CARD_NUMBER, color: color ?? "var(--fg-3)", fontWeight: color ? 500 : 400 }}
      >
        {value}
      </span>
      <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.4 }}>{sub}</span>
    </div>
  );
}

/**
 * How many positions the trace can show without the cells becoming slivers.
 *
 * It shows a window, never the whole key: a thousand positions in a row would
 * be a texture, and the point of the trace is that each cell can be read.
 */
function useTraceWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(26);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measureWidth = () => {
      const width = element.clientWidth;
      setCount(width < 420 ? 12 : width < 640 ? 18 : 26);
    };
    measureWidth();
    const observer = new ResizeObserver(measureWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, count];
}

interface CardSpec {
  label: string;
  value: string;
  sub: string;
  /** Absent where the value was never measured, which prints greyed. */
  color?: string;
}

interface CellSpec {
  bit: string;
  meta: string;
  color: string;
  dim: boolean;
  title: string;
}

function TraceCell({ cell }: { cell: CellSpec }) {
  return (
    <span
      title={cell.title}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "3px 0 2px",
        borderRadius: 5,
        border: `1px solid ${cell.dim ? "var(--line)" : `color-mix(in oklab, ${cell.color} 42%, transparent)`}`,
        background: cell.dim ? "var(--seg)" : `color-mix(in oklab, ${cell.color} 16%, var(--panel-2))`,
        transition: "background .5s ease, border-color .5s ease",
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 11,
          fontWeight: 590,
          lineHeight: 1.15,
          color: cell.dim ? "var(--fg-3)" : cell.color,
        }}
      >
        {cell.bit}
      </span>
      <span className="mono" style={{ fontSize: 8.5, lineHeight: 1.15, color: "var(--fg-3)" }}>
        {cell.meta}
      </span>
    </span>
  );
}

/**
 * The pedagogical core: one column per transmitted position.
 *
 * Reading down a column tells the whole story of one qubit — what Alice
 * prepared, whether Eve touched it, what Bob read, and whether it survived. The
 * aggregate numbers above are what this adds up to; this is where they come
 * from.
 */
function Trace({ views, isBB84, total }: { views: Views; isBB84: boolean; total: number }) {
  const t = useCopy();
  const locale = useLocale();
  const [ref, count] = useTraceWidth();

  const survived = views.survived_sifting.slice(0, count);
  const aliceBases = (views.alice.bases ?? views.alice.angles ?? []).slice(0, count);
  const bobBases = (views.bob.bases ?? views.bob.angles ?? []).slice(0, count);
  const aliceValues = (views.alice.bits ?? views.alice.outcomes ?? []).slice(0, count);
  const bobValues = (views.bob.outcomes ?? []).slice(0, count);
  const eveBases = views.eve?.bases?.slice(0, count);

  // In BB84 the basis is an index into two named bases; in E91 it is an angle,
  // and printing it as a symbol would hide that E91 measures along more than two
  // directions.
  const basisLabel = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "·";
    if (!isBB84) return `${value}°`;
    return value ? "⤢" : "↕";
  };

  const rows: { name: string; field: string; color: string; cells: CellSpec[] }[] = [
    {
      name: t.roles.alice,
      field: isBB84 ? t.fieldABB : t.fieldAE91,
      color: "var(--blue)",
      cells: aliceValues.map((value, index) => ({
        bit: String(value),
        meta: basisLabel(aliceBases[index]),
        color: "var(--blue)",
        dim: false,
        title: `${t.roles.alice}: ${value}`,
      })),
    },
  ];

  if (eveBases) {
    rows.push({
      name: t.roles.eve,
      field: t.fieldEve,
      color: "var(--red)",
      cells: eveBases.map((basis) => ({
        // Null is the whole point of this row: it says exactly which qubits she
        // let past, which the aggregate error rate cannot say.
        bit: basis === null ? "·" : basisLabel(basis),
        meta: basis === null ? "—" : "◆",
        color: basis === null ? "var(--grey)" : "var(--orange)",
        dim: basis === null,
        title: basis === null ? t.traceUntouched : t.traceTouched,
      })),
    });
  }

  rows.push({
    name: t.roles.bob,
    field: isBB84 ? t.fieldBBB : t.fieldBE91,
    color: "var(--mint)",
    cells: bobValues.map((value, index) => ({
      bit: String(value),
      meta: basisLabel(bobBases[index]),
      color: "var(--mint)",
      dim: false,
      title: `${t.roles.bob}: ${value}`,
    })),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <Kicker>{t.traceTitle}</Kicker>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
          {t.tracePositions} 1–{survived.length} / {total.toLocaleString(locale)}
        </span>
      </div>

      <div
        ref={ref}
        style={{
          border: "1px solid var(--line)",
          borderRadius: 14,
          background: "var(--panel)",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 9,
          boxShadow: "inset 0 1px 0 var(--hi)",
          overflow: "hidden",
        }}
      >
        {rows.map((row) => (
          <div
            key={row.name}
            style={{ display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", alignItems: "center", gap: 10 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 590, color: row.color, whiteSpace: "nowrap" }}>
                {row.name}
              </span>
              <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
                {row.field}
              </span>
            </div>
            <div style={{ display: "flex", gap: 2, minWidth: 0 }}>
              {row.cells.map((cell, index) => (
                <TraceCell key={index} cell={cell} />
              ))}
            </div>
          </div>
        ))}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "78px minmax(0,1fr)",
            alignItems: "center",
            gap: 10,
            paddingTop: 2,
            borderTop: "1px solid var(--line)",
          }}
        >
          <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-3)", lineHeight: 1.3 }}>
            {t.traceOutcome}
          </span>
          <div style={{ display: "flex", gap: 2, minWidth: 0 }}>
            {survived.map((kept, index) => {
              const wrong = kept && aliceValues[index] !== bobValues[index];
              const color = !kept ? "var(--line-2)" : wrong ? "var(--red)" : "var(--blue)";
              return (
                <span
                  key={index}
                  title={!kept ? t.droppedLabel : wrong ? t.errorLabel : t.keptLabel}
                  style={{
                    flex: "1 1 0",
                    minWidth: 0,
                    // A discarded position is drawn short rather than absent:
                    // it happened, it just did not make it into the key.
                    height: !kept ? 6 : 14,
                    alignSelf: "center",
                    borderRadius: 3,
                    background: color,
                    boxShadow: kept ? `0 0 8px -3px ${color}` : "none",
                    transition: "height .6s cubic-bezier(.32,.72,0,1), background .6s ease",
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        {[
          { label: t.keptLabel, color: "var(--blue)" },
          { label: t.errorLabel, color: "var(--red)" },
          { label: t.droppedLabel, color: "var(--line-2)" },
          { label: t.interceptedLabel, color: "var(--orange)" },
        ].map((entry) => (
          <div key={entry.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: entry.color, flex: "none" }} />
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{entry.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Results({
  result,
  first,
  isBB84,
  nQubits,
  threshold,
  runId,
  stamp,
}: {
  result: RunResult;
  /** The first trial, the only one that carries the views. */
  first: TrialResult | undefined;
  isBB84: boolean;
  nQubits: number;
  threshold: number;
  runId: string | null;
  stamp: string;
}) {
  const t = useCopy();
  const locale = useLocale();

  const qberZ = first?.qber_by_basis?.rectilinear ?? null;
  const qberX = first?.qber_by_basis?.diagonal ?? null;
  const eveKnowledge = first?.eavesdropper_knowledge ?? null;
  const sigma = first?.chsh_sigma ?? null;
  // The bound acceptance actually uses: the classical 2 plus k standard
  // deviations, not the bare estimate. On a short run S can sit above Tsirelson
  // and still fail this, which is correct — the bound constrains the true value,
  // not a finite-sample estimate of it.
  const chshBound = measured(sigma) ? 2 + 3 * sigma : null;

  const cards: CardSpec[] = [
    {
      label: t.meanQber,
      value: showPercent(result.qber_mean),
      sub: `${t.qberSub} · σ ${(result.qber_stdev * 100).toFixed(2)} %`,
      color: result.qber_mean > threshold ? "var(--red)" : "var(--fg)",
    },
    {
      label: t.siftedKey,
      value: (first?.n_sifted ?? 0).toLocaleString(locale),
      sub: `${t.siftingRatio} ${(first?.sifting_ratio ?? 0).toFixed(3)} · ${t.siftedSub}`,
      color: "var(--fg)",
    },
  ];

  if (isBB84) {
    cards.push(
      { label: t.qberZ, value: showPercent(qberZ), sub: t.zSub, color: measured(qberZ) ? "var(--blue)" : undefined },
      { label: t.qberX, value: showPercent(qberX), sub: t.xSub, color: measured(qberX) ? "var(--purple)" : undefined },
      { label: t.chsh, value: t.na, sub: t.chshSubBB },
    );
  } else {
    cards.push(
      {
        label: t.chsh,
        value: measured(result.chsh_mean) ? result.chsh_mean.toFixed(3) : t.na,
        sub: measured(chshBound) ? `σ ${sigma!.toFixed(3)} · 2+kσ = ${chshBound.toFixed(3)}` : t.naProtocol,
        color:
          measured(result.chsh_mean) && measured(chshBound)
            ? result.chsh_mean > chshBound
              ? "var(--mint)"
              : "var(--red)"
            : undefined,
      },
      { label: t.qberZ, value: t.na, sub: t.naProtocol },
    );
  }

  cards.push(
    measured(eveKnowledge)
      ? { label: t.eveKnows, value: showPercent(eveKnowledge, 0), sub: t.eveSub, color: "var(--red)" }
      : // Null, not zero: nobody is listening is not the same as an eavesdropper
        // who learned nothing.
        { label: t.eveKnows, value: t.na, sub: t.naEve },
  );

  const chart = isBB84
    ? {
        series: [
          {
            label: t.barQber,
            value: result.qber_mean,
            color: result.qber_mean > threshold ? "var(--red)" : "var(--mint)",
            text: showPercent(result.qber_mean),
          },
          ...(measured(qberZ)
            ? [{ label: t.barZ, value: qberZ, color: "var(--blue)", text: showPercent(qberZ) }]
            : []),
          ...(measured(qberX)
            ? [{ label: t.barX, value: qberX, color: "var(--purple)", text: showPercent(qberX) }]
            : []),
        ],
        // Scaled to the threshold rather than fixed, so a run far below it is
        // still legible instead of three stubs against the left edge.
        max: Math.max(0.25, result.qber_mean * 1.3, threshold * 1.6),
        ticks: [0, 0.05, 0.1, 0.15, 0.2, 0.25],
        formatTick: (value: number) => `${(value * 100).toFixed(0)} %`,
        rule: { value: threshold, color: "var(--red)", label: `${t.threshold} ${(threshold * 100).toFixed(1)} %` },
        zones: { leftLabel: t.zoneAccept, rightLabel: t.zoneReject, leftAccepts: true },
        axisTitle: t.axisQber,
        caption: t.chartCapBB,
        title: t.gaugeTitle,
      }
    : {
        series: [
          {
            label: t.barS,
            value: result.chsh_mean ?? 0,
            color:
              measured(result.chsh_mean) && measured(chshBound) && result.chsh_mean > chshBound
                ? "var(--mint)"
                : "var(--red)",
            text: `S = ${measured(result.chsh_mean) ? result.chsh_mean.toFixed(3) : t.na}`,
          },
          { label: t.barTsirelson, value: TSIRELSON, color: "var(--purple)", text: TSIRELSON.toFixed(3) },
        ],
        max: Math.max(TSIRELSON, (result.chsh_mean ?? 0) * 1.05),
        ticks: [0, 0.5, 1, 1.5, 2, TSIRELSON],
        formatTick: (value: number) => value.toFixed(value === TSIRELSON ? 2 : 1),
        rule: {
          value: chshBound ?? 2,
          color: "var(--red)",
          label: `2 + kσ = ${(chshBound ?? 2).toFixed(3)}`,
        },
        // Reversed: below the bound is where the violation fails, so the low
        // side is the rejecting one.
        zones: { leftLabel: t.zoneReject, rightLabel: t.zoneAccept, leftAccepts: false },
        axisTitle: t.axisS,
        caption: t.chartCapE91,
        title: t.gaugeTitleE91,
      };

  return (
    <section
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--bg-2)",
        padding: "18px 28px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        flex: "none",
        animation: "qrise .34s cubic-bezier(.32,.72,0,1) both",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            padding: "8px 14px",
            borderRadius: 20,
            border: `1px solid ${result.accepted ? "var(--mint)" : "var(--red)"}`,
            background: "var(--panel-2)",
            color: result.accepted ? "var(--mint)" : "var(--red)",
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: ".04em",
            boxShadow: "inset 0 1px 0 var(--hi)",
          }}
        >
          {result.accepted ? t.keyAccepted : t.keyRejected}
        </span>
        {/* Shown verbatim: a rejection whose grounds are not stated is
            indistinguishable from a bug. */}
        <span className="mono" style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
          {result.reason}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>
          {stamp}
        </span>
        {runId && (
          <a
            className="mono"
            href={exportUrl(runId)}
            style={{
              fontSize: 11,
              padding: "6px 12px",
              borderRadius: 9,
              border: "1px solid var(--line)",
              background: "var(--panel-2)",
              color: "var(--fg-2)",
            }}
          >
            {t.exportCsv}
          </a>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(186px, 1fr))", gap: 10 }}>
        {cards.map((card) => (
          <Card key={card.label} {...card} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <Kicker>{chart.title}</Kicker>
          <BarChart
            series={chart.series}
            max={chart.max}
            ticks={chart.ticks}
            formatTick={chart.formatTick}
            rule={chart.rule}
            zones={chart.zones}
            axisTitle={chart.axisTitle}
          />
          <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>{chart.caption}</span>
        </div>

        {first?.views && <Trace views={first.views} isBB84={isBB84} total={nQubits} />}
      </div>
    </section>
  );
}
