/**
 * Noise against attack, side by side.
 *
 * The claim is that the same mean QBER can come from a noisy fibre or from an
 * eavesdropper, and that only the per-basis split tells them apart. The screen
 * proves it rather than asserting it: both sides are **real runs** on the real
 * engine, tuned so their mean error rates land on the same target, and the bars
 * show what came back.
 *
 * Tuning is the one thing computed here. The damping needed for a given mean
 * error rate comes from inverting the analytic model — QBER_Z = γ/2 and
 * QBER_X = (1 − √(1−γ))/2, which is the asymmetry the whole screen is about —
 * and the intercepted fraction from QBER = 0.25·F. Those give the *inputs*. The
 * numbers displayed are the outputs, and they carry the sampling noise a real
 * run has.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../../api/client";
import type { RunResult, TrialResult } from "../../api/contract";
import { useRun } from "../../api/useRun";
import { LangSwitch, ThemeSwitch } from "../../components/AppearanceControls";
import { BarChart } from "../../components/BarChart";
import { Footer } from "../../components/Footer";
import { Chip, Kicker, RunButton, Segmented, Slider } from "../../components/controls";
import { Banner } from "../../components/Banner";
import { SideSkeleton } from "../../components/Skeleton";
import { usePlugins } from "../../api/queries";
import { Sphere } from "../../components/Sphere";
import { useCopy } from "../../i18n/useCopy";
import { measured } from "../../lib/nullable";
import { clamp, lengthFromGamma } from "../../lib/physics";

const QUBITS = 4000;
const SEED = 20260818;
/** Not zero: a line with no noise at all is not the case being compared. */
const CLEAN_GAMMA = 0.004;

/** The mean BB84 error rate amplitude damping produces, per the model. */
const meanQberFor = (gamma: number): number => (gamma / 2 + (1 - Math.sqrt(1 - gamma)) / 2) / 2;

/**
 * The damping that lands the mean error rate on `target`.
 *
 * Bisection rather than algebra: the relation is monotone on [0, 1) and
 * inverting it by hand would trade a readable line for a fragile one.
 */
function gammaForMeanQber(target: number): number {
  let low = 0;
  let high = 0.985;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (meanQberFor(middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

interface SideView {
  result: RunResult;
  first: TrialResult;
}

/** The two-node scene above each panel: the same material as the whiteboard. */
function MiniScene({ withEve, accent, label }: { withEve: boolean; accent: string; label: string }) {
  const nodes = [
    { color: "var(--blue)", left: "14%", d: 40, name: "Alice" },
    { color: "var(--mint)", left: "86%", d: 40, name: "Bob" },
    ...(withEve ? [{ color: "var(--red)", left: "50%", d: 30, name: "Eve" }] : []),
  ];

  return (
    <div
      style={{
        position: "relative",
        height: 104,
        borderRadius: 14,
        border: "1px solid var(--line)",
        background: `radial-gradient(80% 120% at 50% 30%, color-mix(in oklab, ${accent} 8%, var(--sky)) 0%, var(--sky) 70%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "14%",
          right: "14%",
          top: "50%",
          height: 2,
          transform: "translateY(-50%)",
          borderRadius: 2,
          background: `linear-gradient(90deg, var(--blue), ${withEve ? "var(--red)" : "var(--mint)"} 50%, var(--mint))`,
          opacity: 0.75,
          boxShadow: `0 0 14px -4px ${accent}`,
          zIndex: 1,
        }}
      />
      {nodes.map((node) => (
        <div
          key={node.name}
          style={{
            position: "absolute",
            left: node.left,
            top: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            zIndex: 3,
          }}
        >
          <Sphere color={node.color} d={node.d} />
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--fg-2)",
              whiteSpace: "nowrap",
              textShadow: "0 1px 3px var(--shadow)",
            }}
          >
            {node.name}
          </span>
        </div>
      ))}
      <span
        className="mono"
        style={{
          position: "absolute",
          left: "50%",
          bottom: 8,
          transform: "translateX(-50%)",
          fontSize: 9.5,
          color: "var(--fg-3)",
          whiteSpace: "nowrap",
          zIndex: 4,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Errors laid out position by position, from the run's own views.
 *
 * Each cell is a sifted position: tall and red where Alice and Bob disagree,
 * short and grey where they do not. Split per basis, the noise side shows about
 * twice as many tall cells in the Z row as in the X row while the attack side
 * shows the same in both — the argument made visible rather than stated.
 */
function ErrorStrip({
  name,
  color,
  positions,
  errorLabel,
  okLabel,
}: {
  name: string;
  color: string;
  positions: boolean[];
  errorLabel: string;
  okLabel: string;
}) {
  const errors = positions.filter(Boolean).length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 8 }}>
      <span className="mono" style={{ fontSize: 11, color, whiteSpace: "nowrap" }}>
        {name}
      </span>
      <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)", textAlign: "right", whiteSpace: "nowrap" }}>
        {errors}/{positions.length}
      </span>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 1, minWidth: 0, height: 24, alignItems: "center" }}>
        {positions.map((bad, index) => (
          <span
            key={index}
            title={bad ? errorLabel : okLabel}
            style={{
              flex: "1 1 0",
              minWidth: 2,
              height: bad ? 22 : 8,
              alignSelf: "center",
              borderRadius: 2,
              background: bad ? "var(--red)" : "var(--line-2)",
              boxShadow: bad ? "0 0 8px -3px var(--red)" : "none",
              transition: "height .5s cubic-bezier(.32,.72,0,1), background .5s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Whether each sifted position in one basis came out wrong. */
function errorsInBasis(trial: TrialResult, basis: number | null, limit: number): boolean[] {
  const views = trial.views;
  if (!views) return [];
  const aliceBits = views.alice.bits ?? [];
  const bobOutcomes = views.bob.outcomes ?? [];
  const bases = views.alice.bases ?? [];
  const out: boolean[] = [];
  for (let index = 0; index < views.survived_sifting.length && out.length < limit; index++) {
    if (!views.survived_sifting[index]) continue;
    if (basis !== null && bases[index] !== basis) continue;
    out.push(aliceBits[index] !== bobOutcomes[index]);
  }
  return out;
}

export default function Comparison() {
  const t = useCopy();
  const noise = useRun();
  const attack = useRun();
  const backend = usePlugins();

  const [targetPct, setTargetPct] = useState(11);
  const [split, setSplit] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  /** The parameters the runs on screen were actually launched with. */
  const [shown, setShown] = useState<{ target: number; gamma: number; fraction: number } | null>(null);

  const target = targetPct / 100;
  const gamma = useMemo(() => gammaForMeanQber(target), [target]);
  const fraction = useMemo(() => clamp((target - meanQberFor(CLEAN_GAMMA)) / 0.25, 0, 1), [target]);

  const launchNoise = noise.launch;
  const launchAttack = attack.launch;

  const launch = useCallback(async () => {
    setFailure(null);
    setShown({ target, gamma, fraction });
    const base = { protocol: "bb84" as const, n_qubits: QUBITS, trials: 1, seed: SEED };
    try {
      // Both sides start together: the server allows several concurrent runs,
      // and sequencing them would double a wait nothing requires.
      await Promise.all([
        launchNoise({
          ...base,
          channel: { kind: "amplitude_damping", gamma: Number(gamma.toFixed(4)) },
          attack: { kind: "none" },
        }),
        launchAttack({
          ...base,
          channel: { kind: "amplitude_damping", gamma: CLEAN_GAMMA },
          attack: { kind: "intercept_resend", fraction: Number(fraction.toFixed(3)) },
        }),
      ]);
    } catch (error) {
      setFailure(error instanceof ApiError ? (error.isBusy ? t.busy : error.detail) : String(error));
    }
  }, [fraction, gamma, launchAttack, launchNoise, target, t]);

  // One run on arrival, so the screen is never an empty frame with a button.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (started) return;
    setStarted(true);
    void launch();
  }, [launch, started]);

  const busy = noise.isRunning || attack.isRunning;

  const sides: (SideView | null)[] = [
    noise.result && noise.trials[0] ? { result: noise.result, first: noise.trials[0] } : null,
    attack.result && attack.trials[0] ? { result: attack.result, first: attack.trials[0] } : null,
  ];

  const ticks = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
  const cells = split ? 36 : 40;
  const km = lengthFromGamma(shown?.gamma ?? 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg)" }}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 18,
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
            {t.comparisonTitle}
          </span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
            {shown ? `${(shown.target * 100).toFixed(1)} %` : "—"} · seed {SEED} · n = {QUBITS} ·{" "}
            {split ? "Z / X" : "mean"}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <LangSwitch />
        <ThemeSwitch />
      </header>

      <main style={{ padding: 26, display: "flex", flexDirection: "column", gap: 22, maxWidth: 1500, margin: "0 auto" }}>
        {backend.isError && <Banner tone="error">{t.backendDown}</Banner>}

        {/* Stated rather than left to be discovered: someone arriving from E91
            has no way of knowing this screen does not apply to it. */}
        <Banner tone="notice">
          <strong>{t.bb84Only}</strong> — {t.bb84OnlyWhy}
        </Banner>

        <section
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 18,
            alignItems: "flex-end",
            padding: "18px 20px",
            border: "1px solid var(--line)",
            borderRadius: 16,
            background: "var(--panel)",
            boxShadow: "inset 0 1px 0 var(--hi)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 300px", minWidth: 260 }}>
            <Slider
              label={t.targetLabel}
              display={`${targetPct.toFixed(1).replace(/\.0$/, "")} %`}
              hint={t.targetHint}
              min={2}
              max={24}
              step={0.5}
              value={targetPct}
              onChange={setTargetPct}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 260px", minWidth: 240 }}>
            <Kicker>{t.viewLabel}</Kicker>
            <Segmented
              wide
              options={[
                { id: "split" as const, label: t.viewSplit },
                { id: "mean" as const, label: t.viewMean },
              ]}
              value={split ? "split" : "mean"}
              onChange={(value) => setSplit(value === "split")}
            />
            <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--fg-3)" }}>
              {split ? t.viewHintSplit : t.viewHintMean}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "0 0 220px" }}>
            {/* A button rather than a live slider: each side is a four thousand
                qubit simulation, and re-running two of them on every pixel of
                drag would make the control unusable. */}
            <RunButton label={busy ? `${t.running}…` : t.runNow} busy={busy} onClick={launch} />
            {(failure || noise.error || attack.error) && (
              <span style={{ fontSize: 11, color: "var(--red)", lineHeight: 1.5 }}>
                {failure ?? noise.error ?? attack.error}
              </span>
            )}
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          {t.insights.map((insight) => (
            <div
              key={insight.step}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 11,
                padding: 20,
                border: "1px solid var(--line)",
                borderRadius: 16,
                background: "var(--panel)",
                boxShadow: "inset 0 1px 0 var(--hi)",
              }}
            >
              <span className="kicker">{insight.step}</span>
              <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.3 }}>
                {insight.title}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.65, color: "var(--fg-2)" }}>{insight.body}</span>
            </div>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {[0, 1].map((index) => {
            const meta = t.sides[index]!;
            const isNoise = index === 0;
            const accent = isNoise ? "var(--blue)" : "var(--red)";
            const side = sides[index];
            const basis = side?.first.qber_by_basis ?? null;
            const z = basis?.rectilinear ?? null;
            const x = basis?.diagonal ?? null;
            const mean = side?.result.qber_mean ?? null;
            const ratio = measured(z) && measured(x) && x > 0 ? z / x : null;

            const bars = split
              ? [
                  ...(measured(z)
                    ? [{ label: t.barZ, value: z, color: "var(--blue)", text: `${(z * 100).toFixed(2)} %` }]
                    : []),
                  ...(measured(x)
                    ? [{ label: t.barX, value: x, color: "var(--purple)", text: `${(x * 100).toFixed(2)} %` }]
                    : []),
                ]
              : measured(mean)
                ? [{ label: t.barMean, value: mean, color: accent, text: `${(mean * 100).toFixed(2)} %` }]
                : [];

            const strips = side
              ? split
                ? [
                    { name: t.zRow, color: "var(--blue)", positions: errorsInBasis(side.first, 0, cells) },
                    { name: t.xRow, color: "var(--purple)", positions: errorsInBasis(side.first, 1, cells) },
                  ]
                : [{ name: t.allRow, color: "var(--fg-2)", positions: errorsInBasis(side.first, null, cells) }]
              : [];

            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                  padding: 22,
                  border: `1px solid ${split ? `color-mix(in oklab, ${accent} 26%, var(--line))` : "var(--line)"}`,
                  borderRadius: 18,
                  background: "var(--panel)",
                  boxShadow: "0 26px 60px -46px #000, inset 0 1px 0 var(--hi)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                    <span
                      className="mono"
                      style={{ fontSize: 10.5, letterSpacing: ".12em", color: accent, fontWeight: 500 }}
                    >
                      {meta.kicker}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.02em" }}>{meta.name}</span>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-2)" }}>{meta.desc}</span>
                  </div>
                  <Chip color={isNoise ? "var(--mint)" : "var(--red)"}>{meta.tag}</Chip>
                </div>

                <MiniScene
                  withEve={!isNoise}
                  accent={accent}
                  label={
                    isNoise
                      ? `damping γ ${(shown?.gamma ?? 0).toFixed(3)} · ${km.toFixed(1)} km`
                      : `F ${(shown?.fraction ?? 0).toFixed(2)} · γ ${CLEAN_GAMMA.toFixed(3)}`
                  }
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                    gap: 14,
                    padding: "14px 16px",
                    border: "1px solid var(--line-2)",
                    borderRadius: 13,
                    background: "var(--panel-2)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span
                      className="mono"
                      style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--fg-3)" }}
                    >
                      {t.meanQber}
                    </span>
                    <span className="mono" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1, color: "var(--fg)" }}>
                      {measured(mean) ? `${(mean * 100).toFixed(2)} %` : "—"}
                    </span>
                  </div>
                  {split && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, textAlign: "right" }}>
                      <span
                        className="mono"
                        style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--fg-3)" }}
                      >
                        {t.asymShort}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 22,
                          fontWeight: 600,
                          lineHeight: 1,
                          color: ratio === null ? "var(--fg-3)" : ratio > 1.5 ? "var(--blue)" : "var(--red)",
                        }}
                      >
                        {ratio === null ? "—" : `${ratio.toFixed(2)}×`}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <Kicker>{split ? t.chartSplit : t.chartMean}</Kicker>
                  {bars.length === 0 && <SideSkeleton active={busy} bars={split ? 2 : 1} />}
                  {bars.length > 0 && (
                    <BarChart
                      series={bars}
                      max={0.25}
                      ticks={ticks}
                      formatTick={(value) => `${(value * 100).toFixed(0)} %`}
                      rule={{
                        value: shown?.target ?? target,
                        color: "var(--orange)",
                        label: `${((shown?.target ?? target) * 100).toFixed(1)} %`,
                      }}
                      axisTitle={t.axisQber}
                    />
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <Kicker>{split ? t.stripTitle : t.stripTitleMean}</Kicker>
                  {strips.map((strip) => (
                    <ErrorStrip
                      key={strip.name}
                      name={strip.name}
                      color={strip.color}
                      positions={strip.positions}
                      errorLabel={t.stripError}
                      okLabel={t.stripOk}
                    />
                  ))}
                  <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--fg-3)" }}>
                    {split ? meta.note : t.stripNoteMean}
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto" }}>
                  {(isNoise
                    ? [`γ = ${(shown?.gamma ?? 0).toFixed(3)}`, `L ≈ ${km.toFixed(1)} km`, "attack: none"]
                    : [
                        `γ = ${CLEAN_GAMMA.toFixed(3)}`,
                        `F = ${(shown?.fraction ?? 0).toFixed(2)}`,
                        "intercept-resend",
                        measured(side?.first.eavesdropper_knowledge)
                          ? `Eve ${(side!.first.eavesdropper_knowledge! * 100).toFixed(0)} %`
                          : t.na,
                      ]
                  ).map((label) => (
                    <Chip key={label} color={isNoise ? "var(--grey)" : "var(--orange)"}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <section
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 20px",
            border: "1px solid var(--line)",
            borderRadius: 16,
            background: "var(--panel)",
            boxShadow: "inset 0 1px 0 var(--hi)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--orange)",
              boxShadow: "0 0 9px -1px var(--orange)",
              flex: "none",
              animation: "qbreath 3s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--fg)" }}>
            {split ? t.insights[1]!.body : t.insights[0]!.body}
          </span>
        </section>
      </main>

      <Footer />
    </div>
  );
}
