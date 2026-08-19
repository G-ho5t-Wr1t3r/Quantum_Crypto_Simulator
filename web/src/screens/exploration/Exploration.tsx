/**
 * Exploration: turn one run into a curve.
 *
 * Every point on the axis is a full simulation, run by the backend and streamed
 * back as it lands — which is why the figure fills in progressively rather than
 * appearing at the end. A sweep of forty points is forty runs in density-matrix
 * mode, and a progress bar that only completes at the finish is one nobody
 * watches.
 *
 * The axis is a closed set of three. It is not a free path into the
 * configuration, because that would allow sweeping the seed, and a curve of pure
 * noise looks exactly like a result.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../../api/client";
import type { ProtocolKind, SweepAxis, SweepPoint } from "../../api/contract";
import { useRun } from "../../api/useRun";
import { LangSwitch, ThemeSwitch } from "../../components/AppearanceControls";
import { Footer } from "../../components/Footer";
import { Kicker, RunButton, Segmented, Slider } from "../../components/controls";
import { LineChart } from "../../components/LineChart";
import { useAppearance } from "../../app/appearance";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { download, downloadPng, downloadSvg } from "../../lib/download";
import { CLASSICAL_BOUND, MIN_E91_PAIRS, TSIRELSON } from "../../lib/physics";

/** Sensible ranges per axis: wide enough to contain the crossing, no wider. */
const AXIS_RANGE: Record<SweepAxis, { min: number; max: number; lo: number; hi: number; step: number; decimals: number }> = {
  gamma: { min: 0, max: 0.45, lo: 0, hi: 0.3, step: 0.005, decimals: 3 },
  length_km: { min: 0, max: 120, lo: 0, hi: 60, step: 1, decimals: 1 },
  attack_fraction: { min: 0, max: 1, lo: 0, hi: 1, step: 0.02, decimals: 2 },
};

const QUBITS = 1200;
const SEED = 20260818;
const THRESHOLD = 0.11;

export default function Exploration() {
  const t = useCopy();
  const locale = useLocale();
  const { theme } = useAppearance();
  const run = useRun();

  const [protocol, setProtocol] = useState<ProtocolKind>("bb84");
  const [axis, setAxis] = useState<SweepAxis>("gamma");
  const [lo, setLo] = useState(AXIS_RANGE.gamma.lo);
  const [hi, setHi] = useState(AXIS_RANGE.gamma.hi);
  const [points, setPoints] = useState(21);
  const [failure, setFailure] = useState<string | null>(null);

  const plotHost = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [plotWidth, setPlotWidth] = useState(900);

  useLayoutEffect(() => {
    const element = plotHost.current;
    if (!element) return;
    const measure = () => setPlotWidth(Math.max(360, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const isBB84 = protocol === "bb84";
  const range = AXIS_RANGE[axis];

  const changeAxis = useCallback((next: SweepAxis) => {
    setAxis(next);
    setLo(AXIS_RANGE[next].lo);
    setHi(AXIS_RANGE[next].hi);
    run.reset();
  }, [run]);

  const launch = useCallback(async () => {
    setFailure(null);
    try {
      await run.launchSweep({
        config: {
          protocol,
          n_qubits: isBB84 ? QUBITS : Math.max(QUBITS, MIN_E91_PAIRS),
          trials: 1,
          seed: SEED,
          // The swept axis overwrites its own field, so the value given here
          // only matters for the axes that leave it alone. Everything else is
          // pinned, or the sweep would be varying two things at once and the
          // curve would not be a function of the axis.
          channel: { kind: "amplitude_damping", gamma: 0.02 },
          attack: axis === "attack_fraction" ? { kind: "intercept_resend" } : { kind: "none" },
          security: { qber_threshold: THRESHOLD, chsh_confidence: 3 },
        },
        axis,
        start: lo,
        stop: hi,
        points,
      });
    } catch (error) {
      setFailure(error instanceof ApiError ? (error.isBusy ? t.busy : error.detail) : String(error));
    }
  }, [axis, hi, isBB84, lo, points, protocol, run, t]);

  const curve: SweepPoint[] = run.points;
  const xs = curve.map((point) => point.value);

  const series = useMemo(() => {
    if (isBB84) {
      return [
        {
          key: "z",
          label: t.legendZ,
          color: "var(--blue)",
          width: 2,
          values: curve.map((point) => point.qber_by_basis?.rectilinear ?? null),
        },
        {
          key: "x",
          label: t.legendX,
          color: "var(--purple)",
          width: 2,
          values: curve.map((point) => point.qber_by_basis?.diagonal ?? null),
        },
        { key: "qber", label: t.legendQber, color: "var(--mint)", width: 2.8, values: curve.map((point) => point.qber) },
      ];
    }
    return [{ key: "s", label: t.legendS, color: "var(--mint)", width: 2.8, values: curve.map((point) => point.chsh) }];
  }, [curve, isBB84, t]);

  /**
   * Where the curve meets the decision line, by linear interpolation between
   * the two points that straddle it.
   *
   * Interpolating is honest here in a way it would not be inside the curve: the
   * crossing is a reading taken between two measurements, and it is reported as
   * a single number rather than drawn as data.
   */
  const crossing = useMemo(() => {
    for (let index = 1; index < curve.length; index++) {
      const before = curve[index - 1]!;
      const after = curve[index]!;
      if (isBB84) {
        if (before.qber <= THRESHOLD && after.qber > THRESHOLD) {
          return before.value + ((THRESHOLD - before.qber) / (after.qber - before.qber)) * (after.value - before.value);
        }
      } else if (before.chsh !== null && after.chsh !== null) {
        if (before.chsh >= CLASSICAL_BOUND && after.chsh < CLASSICAL_BOUND) {
          return (
            before.value +
            ((before.chsh - CLASSICAL_BOUND) / (before.chsh - after.chsh)) * (after.value - before.value)
          );
        }
      }
    }
    return null;
  }, [curve, isBB84]);

  const acceptedCount = curve.filter((point) => point.accepted).length;

  /**
   * The mean ratio between the two per-basis error rates.
   *
   * Near 2 it says amplitude damping — the channel hits the rectilinear basis
   * about twice as hard. Near 1 it says something symmetric, which is what an
   * intercept-resend looks like. Points where the diagonal rate is essentially
   * zero are skipped rather than divided by.
   */
  const asymmetry = useMemo(() => {
    if (!isBB84) return null;
    const usable = curve
      .map((point) => ({ z: point.qber_by_basis?.rectilinear ?? null, x: point.qber_by_basis?.diagonal ?? null }))
      .filter((pair): pair is { z: number; x: number } => pair.z !== null && pair.x !== null && pair.x > 0.0005);
    if (!usable.length) return null;
    return usable.reduce((total, pair) => total + pair.z / pair.x, 0) / usable.length;
  }, [curve, isBB84]);

  const key = `${protocol}_${axis}`;
  const xTitle = axis === "gamma" ? t.xGamma : axis === "length_km" ? t.xKm : t.xF;
  const formatAxisValue = (value: number) =>
    axis === "length_km" ? value.toFixed(0) : value.toFixed(axis === "attack_fraction" ? 2 : 3);

  const exportCsv = useCallback(() => {
    const header = isBB84
      ? ["value", "qber", "qber_stdev", "qber_rectilinear", "qber_diagonal", "eavesdropper_knowledge", "accepted"]
      : ["value", "qber", "qber_stdev", "chsh", "chsh_stdev", "accepted"];
    const rows = curve.map((point) =>
      (isBB84
        ? [
            point.value,
            point.qber,
            point.qber_stdev,
            point.qber_by_basis?.rectilinear ?? "",
            point.qber_by_basis?.diagonal ?? "",
            point.eavesdropper_knowledge ?? "",
            point.accepted,
          ]
        : [point.value, point.qber, point.qber_stdev, point.chsh ?? "", point.chsh_stdev ?? "", point.accepted]
      )
        // An empty field, never a zero: the same null convention the API uses,
        // in the one format that has no way to state it.
        .map((cell) => (typeof cell === "number" ? cell.toFixed(6) : String(cell)))
        .join(","),
    );
    download(`sweep_${key}.csv`, "text/csv", [header.join(","), ...rows].join("\n"));
  }, [curve, isBB84, key]);

  const done = curve.length;
  const progress = points === 0 ? 0 : Math.min(1, done / points);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 6,
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: "14px 26px",
          borderBottom: "1px solid var(--line)",
          background: "color-mix(in oklab, var(--bg-2) 92%, transparent)",
          backdropFilter: "blur(14px)",
        }}
      >
        <Link
          to="/run"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 13px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--panel-2)",
            color: "var(--fg)",
            fontSize: 12.5,
            fontWeight: 500,
            whiteSpace: "nowrap",
            boxShadow: "inset 0 1px 0 var(--hi)",
          }}
        >
          ← {t.back}
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", whiteSpace: "nowrap" }}>
            {t.explorationTitle}
          </span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
            {isBB84 ? "BB84" : "E91"} · {axis} · {points} · seed {SEED}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <Link
          to="/compare"
          style={{
            display: "inline-flex",
            padding: "7px 13px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--panel-2)",
            color: "var(--fg)",
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
            boxShadow: "inset 0 1px 0 var(--hi)",
          }}
        >
          {t.compareCta} →
        </Link>
        <LangSwitch />
        <ThemeSwitch />
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "322px minmax(0, 1fr)",
          alignItems: "start",
          minHeight: "calc(100vh - 61px)",
        }}
      >
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            padding: 22,
            borderRight: "1px solid var(--line)",
            background: "var(--bg-2)",
            position: "sticky",
            top: 61,
            maxHeight: "calc(100vh - 61px)",
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Kicker>{t.protocol}</Kicker>
            <Segmented
              wide
              options={[
                { id: "bb84" as ProtocolKind, label: "BB84" },
                { id: "e91" as ProtocolKind, label: "E91" },
              ]}
              value={protocol}
              onChange={(value) => {
                setProtocol(value);
                run.reset();
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Kicker>{t.axisLabel}</Kicker>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {t.axes.map((option) => {
                const active = axis === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => changeAxis(option.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "11px 13px",
                      border: `1px solid ${active ? "color-mix(in oklab, var(--blue) 40%, var(--line))" : "var(--line)"}`,
                      borderRadius: 11,
                      background: active ? "var(--panel-3)" : "var(--panel)",
                      color: "var(--fg)",
                      cursor: "pointer",
                      textAlign: "left",
                      boxShadow: active ? "inset 0 1px 0 var(--hi)" : "none",
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 590 }}>{option.label}</span>
                      <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>
                        {option.field}
                      </span>
                    </span>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        flex: "none",
                        background: active ? "var(--blue)" : "transparent",
                        border: `1px solid ${active ? "var(--blue)" : "var(--line-2)"}`,
                        boxShadow: active ? "0 0 8px -1px var(--blue)" : "none",
                      }}
                    />
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--fg-3)" }}>{t.axisHint}</span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
            }}
          >
            <Slider
              label={t.rangeMin}
              display={axis === "length_km" ? `${lo.toFixed(1)} km` : lo.toFixed(range.decimals)}
              min={range.min}
              max={range.max}
              step={range.step}
              value={lo}
              onChange={(value) => setLo(Math.min(value, hi - range.step))}
            />
            <Slider
              label={t.rangeMax}
              display={axis === "length_km" ? `${hi.toFixed(1)} km` : hi.toFixed(range.decimals)}
              min={range.min}
              max={range.max}
              step={range.step}
              value={hi}
              onChange={(value) => setHi(Math.max(value, lo + range.step))}
            />
            <Slider
              label={t.points}
              display={String(points)}
              min={2}
              max={60}
              step={1}
              value={points}
              onChange={setPoints}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 9,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
            }}
          >
            <Kicker>{t.fixedLabel}</Kicker>
            {[
              [t.qubitsPerPoint, QUBITS.toLocaleString(locale)],
              [t.trials, "1"],
              [t.seed, String(SEED)],
              isBB84 ? [t.threshold, "11.0 %"] : [t.confidence, "k = 3"],
              axis === "attack_fraction" ? ["γ", "0.020"] : [t.fraction, "0.00"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 11.5, color: "var(--fg-2)", whiteSpace: "nowrap" }}>{label}</span>
                <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)", whiteSpace: "nowrap" }}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
            }}
          >
            <RunButton
              label={run.isRunning ? `${t.sweeping}…` : done ? t.rerun : t.runSweep}
              busy={run.isRunning}
              onClick={launch}
            />
            <div style={{ height: 3, borderRadius: 3, background: "var(--seg)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${(progress * 100).toFixed(1)}%`,
                  background: "linear-gradient(90deg, var(--blue), var(--mint))",
                  transition: "width .12s linear",
                }}
              />
            </div>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
              {done} / {points}
            </span>
            {(failure || run.error) && (
              <span style={{ fontSize: 11, color: "var(--red)", lineHeight: 1.5 }}>{failure ?? run.error}</span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 9,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
            }}
          >
            <Kicker>{t.exportLabel}</Kicker>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { label: "PNG", action: () => svgRef.current && downloadPng(svgRef.current, `sweep_${key}.png`, theme === "dark" ? "#0b0b0e" : "#ffffff") },
                { label: "SVG", action: () => svgRef.current && downloadSvg(svgRef.current, `sweep_${key}.svg`) },
                { label: "CSV", action: exportCsv },
              ].map((button) => (
                <button
                  key={button.label}
                  type="button"
                  onClick={button.action}
                  disabled={!done}
                  className="mono"
                  style={{
                    flex: 1,
                    padding: "9px 10px",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    background: "var(--panel-2)",
                    color: done ? "var(--fg)" : "var(--fg-3)",
                    fontSize: 11.5,
                    cursor: done ? "pointer" : "default",
                    boxShadow: "inset 0 1px 0 var(--hi)",
                  }}
                >
                  {button.label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--fg-3)" }}>{t.exportHint}</span>
          </div>
        </aside>

        <main style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "20px 22px 18px",
              border: "1px solid var(--line)",
              borderRadius: 18,
              background: "var(--panel)",
              boxShadow: "0 26px 60px -46px #000, inset 0 1px 0 var(--hi)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <Kicker>{t.figureKicker}</Kicker>
                <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.02em" }}>{t.titles[key]}</span>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                {[
                  ...series.map((entry) => ({ label: entry.label, color: entry.color, dashed: false })),
                  { label: isBB84 ? t.legendThrQber : t.legendThrS, color: "var(--red)", dashed: true },
                ].map((entry) => (
                  <div key={entry.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      style={
                        entry.dashed
                          ? { width: 14, height: 0, borderTop: `2px dashed ${entry.color}`, flex: "none" }
                          : { width: 14, height: 3, borderRadius: 2, background: entry.color, flex: "none" }
                      }
                    />
                    <span style={{ fontSize: 11.5, color: "var(--fg-2)", whiteSpace: "nowrap" }}>{entry.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div ref={plotHost}>
              <LineChart
                ref={svgRef}
                xs={xs}
                series={series}
                xDomain={[lo, hi]}
                yMax={isBB84 ? 0.5 : 3}
                yTicks={isBB84 ? [0, 0.1, 0.2, 0.3, 0.4, 0.5] : [0, 0.5, 1, 1.5, 2, 2.5, TSIRELSON]}
                formatY={(value) => (isBB84 ? `${(value * 100).toFixed(0)} %` : value.toFixed(value === TSIRELSON ? 2 : 1))}
                formatX={formatAxisValue}
                rule={{
                  value: isBB84 ? THRESHOLD : CLASSICAL_BOUND,
                  label: isBB84 ? t.legendThrQber : t.legendThrS,
                }}
                crossing={crossing}
                formatCrossing={(value) => (axis === "length_km" ? `${value.toFixed(1)} km` : value.toFixed(3))}
                xTitle={xTitle}
                yTitle={isBB84 ? t.yQber : t.yS}
                width={plotWidth}
                acceptFill={isBB84 ? "var(--mint)" : "var(--blue)"}
              />
            </div>

            <span style={{ fontSize: 12, lineHeight: 1.6, color: "var(--fg-3)", maxWidth: "96ch" }}>
              {t.captions[key]}
            </span>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            {[
              {
                label: t.crossing,
                value:
                  crossing === null
                    ? t.crossingNone
                    : axis === "length_km"
                      ? `${crossing.toFixed(1)} km`
                      : crossing.toFixed(3),
                color: crossing === null ? "var(--fg-3)" : "var(--red)",
                big: crossing !== null,
                sub: isBB84 ? t.crossingSubQ : t.crossingSubS,
              },
              {
                label: t.acceptedRuns,
                value: `${acceptedCount} / ${done}`,
                color: acceptedCount ? "var(--mint)" : "var(--red)",
                big: true,
                sub: t.ofPoints,
              },
              asymmetry === null
                ? { label: t.asymmetry, value: t.na, color: "var(--fg-3)", big: false, sub: t.asymmetryNaSub }
                : {
                    label: t.asymmetry,
                    value: `${asymmetry.toFixed(2)}×`,
                    color: "var(--blue)",
                    big: true,
                    sub: t.asymmetrySub,
                  },
            ].map((readout) => (
              <div
                key={readout.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "16px 18px",
                  border: "1px solid var(--line)",
                  borderRadius: 14,
                  background: "var(--panel)",
                  boxShadow: "inset 0 1px 0 var(--hi)",
                }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--fg-3)" }}
                >
                  {readout.label}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: readout.big ? 24 : 15, fontWeight: 600, lineHeight: 1.15, color: readout.color }}
                >
                  {readout.value}
                </span>
                <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--fg-3)" }}>{readout.sub}</span>
              </div>
            ))}
          </section>

          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "20px 22px",
              border: "1px solid var(--line)",
              borderRadius: 18,
              background: "var(--panel)",
              boxShadow: "inset 0 1px 0 var(--hi)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <Kicker>{t.tableTitle}</Kicker>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                {t.tableNote}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                maxHeight: 240,
                overflowY: "auto",
                border: "1px solid var(--line)",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  padding: "9px 12px",
                  background: "var(--seg)",
                  borderBottom: "1px solid var(--line)",
                  position: "sticky",
                  top: 0,
                }}
              >
                {(isBB84
                  ? [axis, t.meanQber, "Z", "X", t.thVerdict]
                  : [axis, t.meanQber, "S", t.thVerdict]
                ).map((heading, index) => (
                  <span
                    key={heading}
                    className="mono"
                    style={{ flex: index === 0 ? 1.2 : 1, minWidth: 0, fontSize: 11, color: "var(--fg-3)" }}
                  >
                    {heading}
                  </span>
                ))}
              </div>
              {curve.map((point, index) => {
                const cells = isBB84
                  ? [
                      { text: formatAxisValue(point.value), color: "var(--fg)", grow: 1.2 },
                      { text: `${(point.qber * 100).toFixed(2)} %`, color: point.accepted ? "var(--mint)" : "var(--red)", grow: 1 },
                      {
                        text:
                          point.qber_by_basis?.rectilinear != null
                            ? `${(point.qber_by_basis.rectilinear * 100).toFixed(2)} %`
                            : "—",
                        color: "var(--blue)",
                        grow: 1,
                      },
                      {
                        text:
                          point.qber_by_basis?.diagonal != null
                            ? `${(point.qber_by_basis.diagonal * 100).toFixed(2)} %`
                            : "—",
                        color: "var(--purple)",
                        grow: 1,
                      },
                      {
                        text: point.accepted ? t.accepted : t.rejected,
                        color: point.accepted ? "var(--mint)" : "var(--red)",
                        grow: 1,
                      },
                    ]
                  : [
                      { text: formatAxisValue(point.value), color: "var(--fg)", grow: 1.2 },
                      { text: `${(point.qber * 100).toFixed(2)} %`, color: "var(--fg-2)", grow: 1 },
                      { text: point.chsh !== null ? point.chsh.toFixed(3) : "—", color: point.accepted ? "var(--mint)" : "var(--red)", grow: 1 },
                      {
                        text: point.accepted ? t.accepted : t.rejected,
                        color: point.accepted ? "var(--mint)" : "var(--red)",
                        grow: 1,
                      },
                    ];
                return (
                  <div
                    key={point.value}
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "7px 12px",
                      background: index % 2 ? "var(--panel-2)" : "var(--panel)",
                    }}
                  >
                    {cells.map((cell, cellIndex) => (
                      <span
                        key={cellIndex}
                        className="mono"
                        style={{
                          flex: cell.grow,
                          minWidth: 0,
                          fontSize: 11,
                          color: cell.color,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {cell.text}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>

      <Footer />
    </div>
  );
}
