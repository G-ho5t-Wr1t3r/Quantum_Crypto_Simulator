/**
 * Where the protocol can be operated at all.
 *
 * The other two analysis screens answer questions about a line: a run says what
 * happened at one point, a sweep says how a quantity moves along one axis. This
 * one is about an area — for every fibre length, how much interception is still
 * survivable — and it is the only place the two limits are visible as one shape
 * rather than as two separate curves.
 *
 * ITS REAL SUBJECT IS THAT ACCEPTED IS NOT THE SAME AS SAFE. Every accepted
 * cell is coloured by how much of the key the eavesdropper holds in it, so a
 * run that passes the threshold while she knows forty percent of the key looks
 * different from one where she knows nothing — which the verdict alone cannot
 * say, and which is the whole reason the threshold is a starting point for
 * privacy amplification rather than a finish line.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { usePlugins } from "../../api/queries";
import type { ProtocolKind } from "../../api/contract";
import { LangSwitch, ThemeSwitch } from "../../components/AppearanceControls";
import { ScreenTabs } from "../../components/ScreenTabs";
import { Banner } from "../../components/Banner";
import { Kicker, RunButton, Segmented, Slider } from "../../components/controls";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { download, downloadPng, downloadSvg, type ExportTheme } from "../../lib/download";
import { MIN_E91_PAIRS } from "../../lib/physics";
import { Heatmap } from "./Heatmap";
import { useEnvelope } from "./useEnvelope";

const SEED = 20260818;
const THRESHOLD = 0.11;
/** Rough cost of one cell, from measurement, for the estimate shown up front. */
const SECONDS_PER_CELL = 0.5;
export default function Envelope() {
  const t = useCopy();
  const locale = useLocale();
  const backend = usePlugins();
  const map = useEnvelope();

  const [protocol, setProtocol] = useState<ProtocolKind>("bb84");
  const [maxKm, setMaxKm] = useState(12);
  const [lengthSteps, setLengthSteps] = useState(9);
  const [fractionSteps, setFractionSteps] = useState(9);
  const [qubits, setQubits] = useState(800);
  const [exportTheme, setExportTheme] = useState<ExportTheme>("light");
  const plot = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [plotWidth, setPlotWidth] = useState(900);

  useLayoutEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => setPlotWidth(Math.max(420, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * Any parameter change throws the map away.
   *
   * A grid computed for nine lengths, still on screen while the sidebar says
   * fifteen, is a figure that no longer describes its own caption — and unlike a
   * single run there is no verdict on it to give the mismatch away.
   */
  const clear = map.clear;
  const set = useCallback(
    <T,>(setter: (value: T) => void) =>
      (value: T) => {
        setter(value);
        clear();
      },
    [clear],
  );

  const isBB84 = protocol === "bb84";
  const lengths = useMemo(
    () => Array.from({ length: lengthSteps }, (_, index) => (maxKm * index) / (lengthSteps - 1)),
    [lengthSteps, maxKm],
  );
  const cells = lengthSteps * fractionSteps;

  const compute = useCallback(() => {
    void map.compute({
      protocol,
      lengths,
      fractionSteps,
      // E91 needs enough pairs for every angle combination to see some.
      qubits: isBB84 ? qubits : Math.max(qubits, MIN_E91_PAIRS * 4),
      seed: SEED,
      threshold: THRESHOLD,
    });
  }, [fractionSteps, isBB84, lengths, map, protocol, qubits]);

  const choose = useCallback(
    (next: ProtocolKind) => {
      if (next === protocol) return;
      setProtocol(next);
      map.clear();
    },
    [map, protocol],
  );

  /**
   * The two edges of the envelope, read off the map.
   *
   * Both are answers to questions an engineer actually asks: how far can this
   * go, and how much can be tolerated before it stops working.
   */
  const reach = useMemo(() => {
    const clean = map.rows.filter((row) => row.points[0]?.accepted);
    return clean.length ? Math.max(...clean.map((row) => row.km)) : null;
  }, [map.rows]);

  const tolerated = useMemo(() => {
    const first = map.rows[0];
    if (!first) return null;
    const ok = first.points.filter((point) => point.accepted);
    return ok.length ? Math.max(...ok.map((point) => point.value)) : null;
  }, [map.rows]);

  const accepted = map.rows.reduce(
    (total, row) => total + row.points.filter((point) => point.accepted).length,
    0,
  );
  const done = map.rows.reduce((total, row) => total + row.points.length, 0);

  /**
   * How a cell is painted.
   *
   * Rejected cells are one flat, quiet red: there is nothing to grade about a
   * key that was discarded. Accepted cells run from mint to orange with the
   * share the attacker holds, so the eye finds the corner of the envelope where
   * the protocol says yes and the attacker is nearly halfway into the key.
   */
  const exportCsv = useCallback(() => {
    const header = ["length_km", "attack_fraction", "qber", "chsh", "eavesdropper_knowledge", "accepted"];
    const lines = map.rows.flatMap((row) =>
      row.points.map((point) =>
        [
          row.km.toFixed(3),
          point.value.toFixed(3),
          point.qber.toFixed(6),
          point.chsh?.toFixed(6) ?? "",
          point.eavesdropper_knowledge?.toFixed(6) ?? "",
          String(point.accepted),
        ].join(","),
      ),
    );
    download(`envelope_${protocol}.csv`, "text/csv", [header.join(","), ...lines].join("\n"));
  }, [map.rows, protocol]);

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
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", whiteSpace: "nowrap" }}>
            {t.envelopeTitle}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <ScreenTabs />
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
            // Both, so the panel fills the viewport when the controls are short
            // and scrolls when they are not: with only a maximum it stopped
            // three quarters of the way down and the border ended in mid-air.
            minHeight: "calc(100vh - 61px)",
            maxHeight: "calc(100vh - 61px)",
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Kicker>{t.protocol}</Kicker>
            <Segmented<ProtocolKind>
              wide
              label={t.protocol}
              disabled={map.running}
              options={[
                { id: "bb84", label: "BB84" },
                { id: "e91", label: "E91" },
              ]}
              value={protocol}
              onChange={choose}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Slider
              label={t.maxLength}
              display={`${maxKm} km`}
              min={2}
              max={30}
              step={1}
              value={maxKm}
              onChange={set(setMaxKm)}
              disabled={map.running}
            />
            <Slider
              label={t.lengthSteps}
              display={String(lengthSteps)}
              min={3}
              max={15}
              step={1}
              value={lengthSteps}
              onChange={set(setLengthSteps)}
              disabled={map.running}
            />
            <Slider
              label={t.fractionSteps}
              display={String(fractionSteps)}
              min={3}
              max={15}
              step={1}
              value={fractionSteps}
              onChange={set(setFractionSteps)}
              disabled={map.running}
            />
            <Slider
              label={t.qubitsPerCell}
              display={qubits.toLocaleString(locale)}
              min={200}
              max={2000}
              step={100}
              value={qubits}
              onChange={set(setQubits)}
              disabled={map.running}
            />
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
            {/* Said before the button, not after: a minute of waiting the reader
                did not expect is a minute they think is a hang. */}
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>
              {cells} {t.cellsLabel} · ≈ {Math.round((cells * SECONDS_PER_CELL * qubits) / 800)} s {t.estimated}
            </span>
            {map.running ? (
              <button
                type="button"
                onClick={map.stop}
                style={{
                  padding: 13,
                  borderRadius: 11,
                  border: "1px solid var(--line)",
                  background: "var(--panel-2)",
                  color: "var(--fg-2)",
                  fontSize: 14,
                  fontWeight: 590,
                  cursor: "pointer",
                }}
              >
                {t.stopMap}
              </button>
            ) : (
              <RunButton label={t.runMap} busy={false} onClick={compute} />
            )}
            <div style={{ height: 3, borderRadius: 3, background: "var(--seg)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${((done / Math.max(1, cells)) * 100).toFixed(1)}%`,
                  background: "linear-gradient(90deg, var(--blue), var(--mint))",
                  transition: "width .2s linear",
                }}
              />
            </div>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
              {done} / {cells}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
            }}
          >
            <Kicker>{t.exportLabel}</Kicker>
            <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{t.exportTheme}</span>
            <Segmented<ExportTheme>
              wide
              label={t.exportTheme}
              disabled={map.running}
              options={[
                { id: "light", label: t.light },
                { id: "dark", label: t.dark },
              ]}
              value={exportTheme}
              onChange={setExportTheme}
            />
            <div style={{ display: "flex", gap: 6 }}>
              {[
                {
                  label: "PNG",
                  action: () =>
                    svgRef.current && downloadPng(svgRef.current, `envelope_${protocol}.png`, exportTheme),
                },
                {
                  label: "SVG",
                  action: () =>
                    svgRef.current && downloadSvg(svgRef.current, `envelope_${protocol}.svg`, exportTheme),
                },
                { label: "CSV", action: exportCsv },
              ].map((button) => (
                <button
                  key={button.label}
                  type="button"
                  onClick={button.action}
                  disabled={!done || map.running}
                  className="mono"
                  style={{
                    flex: 1,
                    padding: "9px 10px",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    background: "var(--panel-2)",
                    color: done && !map.running ? "var(--fg)" : "var(--fg-3)",
                    fontSize: 11.5,
                    cursor: done && !map.running ? "pointer" : "default",
                    boxShadow: "inset 0 1px 0 var(--hi)",
                  }}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main style={{ padding: 22, display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          {backend.isError && <Banner tone="error">{t.backendDown}</Banner>}
          {map.error && <Banner tone="error">{map.error}</Banner>}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Kicker>{t.envelopeTitle}</Kicker>
            <span style={{ fontSize: 13, lineHeight: 1.6, color: "var(--fg-2)", maxWidth: "90ch" }}>
              {t.envelopeLead}
            </span>
          </div>

          <div ref={plot}>
            <Heatmap
              ref={svgRef}
              lengths={lengths}
              fractionSteps={fractionSteps}
              rows={map.rows}
              width={plotWidth}
              running={map.running}
              title={t.envelopeTitle}
              subtitle={`${isBB84 ? "BB84" : "E91"} · ${lengthSteps} × ${fractionSteps} · n=${qubits.toLocaleString(locale)} · seed ${SEED} · ${t.threshold} ${(THRESHOLD * 100).toFixed(0)} %`}
              xTitle={t.axisFraction}
              yTitle={t.axisLength}
              legend={{ accepted: t.legendAccepted, rejected: t.legendRejected, knows: t.legendKnows }}
              showKnowledge={isBB84}
              labels={{ accepted: t.accepted, rejected: t.rejected, na: t.na }}
            />
          </div>

          {!isBB84 && (
            <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5, maxWidth: "96ch" }}>
              {t.mapE91Note}
            </span>
          )}

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 26,
              padding: "4px 2px",
            }}
          >
            {[
              {
                label: t.reach,
                value: reach === null ? "—" : `${reach.toFixed(1)} km`,
                color: reach === null ? "var(--fg-3)" : "var(--mint)",
                sub: t.reachSub,
              },
              {
                label: t.tolerated,
                value: tolerated === null ? "—" : `${(tolerated * 100).toFixed(0)} %`,
                color: tolerated === null ? "var(--fg-3)" : "var(--blue)",
                sub: t.toleratedSub,
              },
              {
                label: t.acceptedCells,
                value: `${accepted} / ${done || cells}`,
                color: accepted ? "var(--mint)" : "var(--fg-3)",
                sub: "",
              },
            ].map((readout) => (
              <div key={readout.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  className="mono"
                  style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--fg-3)" }}
                >
                  {readout.label}
                </span>
                <span className="mono" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15, color: readout.color }}>
                  {readout.value}
                </span>
                {readout.sub && (
                  <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--fg-3)" }}>{readout.sub}</span>
                )}
              </div>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}
