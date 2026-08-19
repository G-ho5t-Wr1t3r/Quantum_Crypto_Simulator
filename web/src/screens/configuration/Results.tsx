/**
 * What the run produced, built up as it is replayed.
 *
 * Every number here comes from the engine. Nothing is recomputed client-side,
 * because a second implementation of the physics is a second thing that can be
 * wrong — and the one on screen would be the one nobody tested.
 *
 * The section appears as soon as the first trial lands rather than waiting for
 * the aggregate, and fills in stage by stage: Alice's row, then Eve's, then
 * Bob's, then the outcome of the sifting, then the readouts. The verdict is the
 * exception and waits for the real result, because it is the only part that
 * reports something instead of illustrating it.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { BarChart } from "../../components/BarChart";
import { Skeleton } from "../../components/Skeleton";
import { Kicker } from "../../components/controls";
import { exportUrl } from "../../api/client";
import type { RunResult, TrialResult, Views } from "../../api/contract";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { measured, showPercent } from "../../lib/nullable";
import { TSIRELSON } from "../../lib/physics";
import { revealed, type Replay } from "./useReplay";

interface CardSpec {
  label: string;
  value: string;
  sub: string;
  /** Absent where the value was never measured, which prints greyed. */
  color?: string;
}

function Card({ label, value, sub, color }: CardSpec) {
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
        style={{
          fontSize: 23,
          fontWeight: color ? 500 : 400,
          letterSpacing: "-.02em",
          color: color ?? "var(--fg-3)",
        }}
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
  const [count, setCount] = useState(30);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      setCount(width < 460 ? 14 : width < 700 ? 22 : width < 1000 ? 30 : 40);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, count];
}

interface CellSpec {
  bit: string;
  meta: string;
  color: string;
  dim: boolean;
  title: string;
}

/**
 * A position the replay has not reached yet.
 *
 * Shown as a shimmering placeholder rather than an empty outline: the value
 * exists and is on its way, and a dashed hole would read as data that is
 * missing instead of data that has not been drawn yet.
 */
function PendingCell() {
  return <Skeleton width={0} height={30} radius={5} style={{ flex: "1 1 0" }} />;
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
        height: 30,
        padding: "3px 0 2px",
        borderRadius: 5,
        border: `1px solid ${cell.dim ? "var(--line)" : `color-mix(in oklab, ${cell.color} 42%, transparent)`}`,
        background: cell.dim ? "var(--seg)" : `color-mix(in oklab, ${cell.color} 16%, var(--panel-2))`,
        // Each cell arrives rather than appears: the row reads as being written
        // left to right, which is the order the qubits actually went in.
        animation: "qrise .22s cubic-bezier(.32,.72,0,1) both",
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
function Trace({
  views,
  isBB84,
  total,
  replay,
}: {
  views: Views;
  isBB84: boolean;
  total: number;
  replay: Replay;
}) {
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

  const rows: { name: string; field: string; color: string; cells: CellSpec[]; upTo: number }[] = [
    {
      name: t.roles.alice,
      field: isBB84 ? t.fieldABB : t.fieldAE91,
      color: "var(--blue)",
      upTo: revealed(count, replay.alice),
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
      upTo: revealed(count, replay.eve),
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
    upTo: revealed(count, replay.bob),
    cells: bobValues.map((value, index) => ({
      bit: String(value),
      meta: basisLabel(bobBases[index]),
      color: "var(--mint)",
      dim: false,
      title: `${t.roles.bob}: ${value}`,
    })),
  });

  const siftedUpTo = revealed(count, replay.sifting);

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
          flex: 1,
          justifyContent: "center",
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
              {row.cells.map((cell, index) =>
                index < row.upTo ? <TraceCell key={index} cell={cell} /> : <PendingCell key={index} />,
              )}
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
          <div style={{ display: "flex", gap: 2, minWidth: 0, height: 16, alignItems: "center" }}>
            {survived.map((kept, index) => {
              if (index >= siftedUpTo) {
                return (
                  <Skeleton key={index} width={0} height={8} radius={3} style={{ flex: "1 1 0" }} />
                );
              }
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
                    transition: "height .3s cubic-bezier(.32,.72,0,1), background .3s ease",
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
          ...(eveBases ? [{ label: t.interceptedLabel, color: "var(--orange)" }] : []),
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

/**
 * What the key is made of, in counts.
 *
 * The trace shows a window of positions; this is the whole of them. Both are
 * needed: one says what happens to a qubit, the other says how much of the run
 * ends up where — and a ratio of 0.5 means nothing until it is two thousand
 * positions out of four.
 *
 * Counted from the views rather than taken from a field, because the engine
 * reports the ratio and the total but not the split, and re-deriving it here
 * from the same arrays the trace draws keeps the two from disagreeing.
 */
function Breakdown({ views, replay }: { views: Views; replay: Replay }) {
  const t = useCopy();
  const locale = useLocale();

  const total = views.survived_sifting.length;
  const aliceValues = views.alice.bits ?? views.alice.outcomes ?? [];
  const bobValues = views.bob.outcomes ?? [];

  let kept = 0;
  let wrong = 0;
  for (let index = 0; index < total; index++) {
    if (!views.survived_sifting[index]) continue;
    kept += 1;
    if (aliceValues[index] !== bobValues[index]) wrong += 1;
  }
  const dropped = total - kept;
  const touched = views.eve?.bases?.filter((basis) => basis !== null).length ?? null;

  const rows: { label: string; count: number; color: string }[] = [
    { label: t.keptLabel, count: kept - wrong, color: "var(--blue)" },
    { label: t.errorLabel, count: wrong, color: "var(--red)" },
    { label: t.droppedLabel, count: dropped, color: "var(--line-2)" },
  ];
  if (touched !== null) rows.push({ label: t.interceptedLabel, count: touched, color: "var(--orange)" });

  const share = (count: number) => (total ? (count / total) * 100 : 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        opacity: replay.sifting,
        transition: "opacity .3s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <Kicker>{t.breakdownTitle}</Kicker>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
          {total.toLocaleString(locale)} {t.sentLabel} · {t.breakdownOf}
        </span>
      </div>

      {/* One bar, divided: the parts are shares of the same whole, and three
          separate bars would invite reading them against each other instead. */}
      <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", background: "var(--seg)" }}>
        {rows.map((row) => (
          <span
            key={row.label}
            title={`${row.label}: ${row.count}`}
            style={{
              width: `${share(row.count).toFixed(2)}%`,
              background: row.color,
              transition: "width .5s cubic-bezier(.32,.72,0,1)",
            }}
          />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        {rows.map((row) => (
          <div key={row.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: row.color, flex: "none" }} />
              <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{row.label}</span>
            </div>
            <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)" }}>
              {row.count.toLocaleString(locale)}
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
              {share(row.count).toFixed(1)} %
            </span>
          </div>
        ))}
      </div>

      {/* The limitation, where the number it qualifies is. The design asked for
          a colour marking the positions sacrificed to the estimate; the engine
          does not model them, and saying so is better than inventing them. */}
      <span style={{ fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.55 }}>{t.breakdownNote}</span>
    </div>
  );
}

/**
 * Every repetition on one axis, so the spread is a picture rather than a sigma.
 *
 * This replaces the per-position trace when a run has more than one trial, and
 * it has to: the views — what Alice prepared, what Eve touched, what Bob read —
 * arrive with the **first trial only**. That is not an oversight in the
 * interface but a deliberate line in the contract: at three thousand qubits one
 * trial's views are already sixty kilobytes, and twenty of them would put well
 * over a megabyte on the socket for a run nobody is going to read position by
 * position.
 *
 * What every trial does carry is its own outcome, and that turns out to be the
 * more useful thing to compare across repetitions. Trials exist to average, and
 * an average is worth exactly as much as its scatter: one bar per trial against
 * the same threshold shows whether the mean sits on a tight cluster or on two
 * far apart, which is the question a single σ can only answer in the abstract.
 */
function TrialComparison({
  trials,
  isBB84,
  threshold,
  bound,
  max,
  mean,
  spread,
  replay,
}: {
  trials: TrialResult[];
  isBB84: boolean;
  threshold: number;
  bound: number;
  max: number;
  mean: number;
  spread: number;
  replay: Replay;
}) {
  const t = useCopy();
  const shown = revealed(trials.length, replay.sifting);

  // Rows thin out as they multiply, so twenty fit in the space three occupy
  // comfortably and the panel never grows past its neighbour.
  const rowHeight = trials.length <= 6 ? 18 : trials.length <= 12 ? 13 : 10;
  const pct = (value: number) => Math.min(100, Math.max(0, (value / max) * 100));
  const rule = isBB84 ? threshold : bound;
  const passes = (value: number) => (isBB84 ? value <= threshold : value >= bound);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <Kicker>{t.trialsTitle}</Kicker>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
          {trials.length} × · {t.trialsSpread} σ {isBB84 ? `${(spread * 100).toFixed(2)} %` : spread.toFixed(3)}
        </span>
      </div>

      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 14,
          background: "var(--panel)",
          padding: "16px 18px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          boxShadow: "inset 0 1px 0 var(--hi)",
          flex: 1,
          justifyContent: "center",
        }}
      >
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: Math.max(3, rowHeight / 3) }}>
          {/* The two rules the eye actually uses: where the decision sits, and
              where the trials centre. Their distance is the margin. */}
          <div
            style={{
              position: "absolute",
              left: `${pct(rule).toFixed(2)}%`,
              top: -4,
              bottom: -4,
              width: 0,
              borderLeft: "1.5px dashed var(--red)",
              zIndex: 3,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${pct(mean).toFixed(2)}%`,
              top: -4,
              bottom: -4,
              width: 0,
              borderLeft: "1.5px solid var(--orange)",
              opacity: 0.8,
              zIndex: 3,
            }}
          />

          {trials.map((trial, index) => {
            const value = isBB84 ? trial.qber : (trial.chsh ?? 0);
            const good = passes(value);
            const text = isBB84 ? showPercent(value) : value.toFixed(3);
            return (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "42px minmax(0,1fr) 58px",
                  alignItems: "center",
                  gap: 8,
                  opacity: index < shown ? 1 : 0,
                  transition: "opacity .25s ease",
                }}
              >
                <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
                  {t.trialLabel} {index + 1}
                </span>
                <div style={{ position: "relative", height: rowHeight, borderRadius: 3, background: "var(--seg)" }}>
                  <div
                    title={text}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${Math.max(0.8, pct(value)).toFixed(2)}%`,
                      borderRadius: 3,
                      background: good ? "var(--mint)" : "var(--red)",
                      transition: "width .5s cubic-bezier(.32,.72,0,1)",
                    }}
                  />
                </div>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: good ? "var(--mint)" : "var(--red)",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {text}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 16, justifyContent: "center", paddingTop: 4 }}>
          {[
            { label: t.trialsMean, color: "var(--orange)", dashed: false },
            { label: isBB84 ? t.threshold : "2 + kσ", color: "var(--red)", dashed: true },
          ].map((entry) => (
            <div key={entry.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={
                  entry.dashed
                    ? { width: 14, height: 0, borderTop: `1.5px dashed ${entry.color}`, flex: "none" }
                    : { width: 14, height: 2, background: entry.color, flex: "none" }
                }
              />
              <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{entry.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Results({
  result,
  trials,
  first,
  isBB84,
  nQubits,
  threshold,
  confidence,
  runId,
  stamp,
  replay,
}: {
  /** The aggregate. The section is not shown until it exists. */
  result: RunResult;
  /** Every repetition, for comparing them against each other. */
  trials: TrialResult[];
  /** The first trial, the only one that carries the views. */
  first: TrialResult;
  isBB84: boolean;
  nQubits: number;
  threshold: number;
  confidence: number;
  runId: string | null;
  stamp: string;
  replay: Replay;
}) {
  const t = useCopy();
  const locale = useLocale();

  const qber = result.qber_mean;
  const chsh = result.chsh_mean;
  const spread = `σ ${(result.qber_stdev * 100).toFixed(2)} %`;
  const qberZ = first.qber_by_basis?.rectilinear ?? null;
  const qberX = first.qber_by_basis?.diagonal ?? null;
  const eveKnowledge = first.eavesdropper_knowledge ?? null;
  const sigma = first.chsh_sigma ?? null;
  // The bound acceptance actually uses: the classical 2 plus k standard
  // deviations, not the bare estimate. On a short run S can sit above Tsirelson
  // and still fail this, which is correct — the bound constrains the true value,
  // not a finite-sample estimate of it.
  const chshBound = measured(sigma) ? 2 + confidence * sigma : null;

  const cards: CardSpec[] = [
    {
      label: t.meanQber,
      value: showPercent(qber),
      // In E91 the error rate is measured but decides nothing: that protocol is
      // judged on the Bell parameter alone. Saying so on the card is what keeps
      // it from reading as a verdict.
      sub: isBB84 ? `${t.qberSub} · ${spread}` : t.qberNotDeciding,
      color: isBB84 && qber > threshold ? "var(--red)" : "var(--fg)",
    },
    {
      label: t.siftedKey,
      value: first.n_sifted.toLocaleString(locale),
      sub: `${t.siftingRatio} ${first.sifting_ratio.toFixed(3)} · ${t.siftedSub}`,
      color: "var(--fg)",
    },
  ];

  if (isBB84) {
    cards.push(
      { label: t.qberZ, value: showPercent(qberZ), sub: t.zSub, color: measured(qberZ) ? "var(--blue)" : undefined },
      { label: t.qberX, value: showPercent(qberX), sub: t.xSub, color: measured(qberX) ? "var(--purple)" : undefined },
    );
  } else {
    // No per-basis cards here, and no CHSH card in BB84 either: a readout whose
    // only possible value is "not applicable" is a row of furniture.
    cards.push({
      label: t.chsh,
      value: measured(chsh) ? chsh.toFixed(3) : t.na,
      sub: measured(chshBound) ? `σ ${sigma!.toFixed(3)} · 2+kσ = ${chshBound.toFixed(3)}` : t.naProtocol,
      color:
        measured(chsh) && measured(chshBound) ? (chsh > chshBound ? "var(--mint)" : "var(--red)") : undefined,
    });
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
        title: t.gaugeTitle,
        series: [
          {
            label: t.barQber,
            value: qber,
            color: qber > threshold ? "var(--red)" : "var(--mint)",
            text: showPercent(qber),
          },
          ...(measured(qberZ) ? [{ label: t.barZ, value: qberZ, color: "var(--blue)", text: showPercent(qberZ) }] : []),
          ...(measured(qberX) ? [{ label: t.barX, value: qberX, color: "var(--purple)", text: showPercent(qberX) }] : []),
        ],
        // Scaled to the threshold rather than fixed, so a run far below it is
        // still legible instead of three stubs against the left edge.
        max: Math.max(0.25, qber * 1.3, threshold * 1.6),
        ticks: [0, 0.05, 0.1, 0.15, 0.2, 0.25],
        formatTick: (value: number) => `${(value * 100).toFixed(0)} %`,
        rule: { value: threshold, color: "var(--red)", label: `${t.threshold} ${(threshold * 100).toFixed(1)} %` },
        zones: { leftLabel: t.zoneAccept, rightLabel: t.zoneReject, leftAccepts: true },
        axisTitle: t.axisQber,
        caption: t.chartCapBB,
      }
    : {
        title: t.gaugeTitleE91,
        series: [
          {
            label: t.barS,
            value: chsh ?? 0,
            color: measured(chsh) && measured(chshBound) && chsh > chshBound ? "var(--mint)" : "var(--red)",
            text: `S = ${measured(chsh) ? chsh.toFixed(3) : t.na}`,
          },
          { label: t.barTsirelson, value: TSIRELSON, color: "var(--purple)", text: TSIRELSON.toFixed(3) },
        ],
        max: Math.max(TSIRELSON, (chsh ?? 0) * 1.05),
        ticks: [0, 0.5, 1, 1.5, 2, TSIRELSON],
        formatTick: (value: number) => value.toFixed(value === TSIRELSON ? 2 : 1),
        rule: { value: chshBound ?? 2, color: "var(--red)", label: `2 + kσ = ${(chshBound ?? 2).toFixed(3)}` },
        // Reversed: below the bound is where the violation fails, so the low
        // side is the rejecting one.
        zones: { leftLabel: t.zoneReject, rightLabel: t.zoneAccept, leftAccepts: false },
        axisTitle: t.axisS,
        caption: t.chartCapE91,
      };

  const readoutsIn = replay.estimate > 0;

  return (
    <section
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--bg-2)",
        padding: "18px 28px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        flex: "1 1 auto",
        animation: "qfade .28s ease both",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minHeight: 34 }}>
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
                animation: "qrise .3s cubic-bezier(.32,.72,0,1) both",
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(186px, 1fr))",
          gap: 10,
          // The readouts are the estimate: they arrive when the replay reaches
          // it, rather than sitting there while the key is still being sifted.
          opacity: readoutsIn ? 1 : 0,
          transform: readoutsIn ? "none" : "translateY(8px)",
          transition: "opacity .4s ease, transform .4s cubic-bezier(.32,.72,0,1)",
        }}
      >
        {cards.map((card) => (
          <Card key={card.label} {...card} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 26 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            minWidth: 0,
            opacity: readoutsIn ? 1 : 0,
            transition: "opacity .4s ease",
          }}
        >
          <Kicker>{chart.title}</Kicker>
          <BarChart
            series={chart.series}
            max={chart.max}
            ticks={chart.ticks}
            formatTick={chart.formatTick}
            rule={chart.rule}
            zones={chart.zones}
            axisTitle={chart.axisTitle}
            fill
          />
          <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>{chart.caption}</span>
        </div>

        {trials.length > 1 ? (
          <TrialComparison
            trials={trials}
            isBB84={isBB84}
            threshold={threshold}
            bound={chshBound ?? 2}
            max={chart.max}
            mean={isBB84 ? qber : (chsh ?? 0)}
            spread={isBB84 ? result.qber_stdev : (result.chsh_stdev ?? 0)}
            replay={replay}
          />
        ) : (
          first.views && <Trace views={first.views} isBB84={isBB84} total={nQubits} replay={replay} />
        )}
      </div>

      {first.views && <Breakdown views={first.views} replay={replay} />}
    </section>
  );
}
