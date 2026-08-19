/**
 * The main tool: configure the run, watch it, read the result in place.
 *
 * The network above is a depiction of what is configured, not a canvas — it is
 * drawn from the topology the backend declares, so it always shows the run that
 * would actually happen. Below it the result builds up as the trial is replayed,
 * in the same view: moving that to another screen would break the connection
 * between the picture and the numbers, which is the connection the screen
 * exists to make.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { copyText } from "../../lib/clipboard";
import { usePlugins } from "../../api/queries";
import { useReducedMotion } from "../../app/appearance";
import { useRun } from "../../api/useRun";
import type { ProtocolKind } from "../../api/contract";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { lengthFromGamma, MIN_E91_PAIRS } from "../../lib/physics";
import { ROLE_COLOR, type Role } from "../../lib/roles";
import { ResultsSkeleton } from "../../components/Skeleton";
import { Inspector } from "./Inspector";
import { NetworkDiagram } from "./NetworkDiagram";
import { Results } from "./Results";
import { Sidebar } from "./Sidebar";
import { useConfiguration } from "./state";
import { useReplay } from "./useReplay";

/** How much vertical room the network gets; the result takes the rest. */
const DIAGRAM_HEIGHT = 360;

export default function Configuration() {
  const t = useCopy();
  const locale = useLocale();
  const [search] = useSearchParams();
  const initialProtocol: ProtocolKind = search.get("protocol") === "e91" ? "e91" : "bb84";

  const plugins = usePlugins();
  const run = useRun();
  const config = useConfiguration(initialProtocol);
  const reduced = useReducedMotion();

  const scroller = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [stamp, setStamp] = useState("");

  const isBB84 = config.params.protocol === "bb84";
  const first = run.trials[0];

  // Keyed on the run, so a second launch replays from the beginning instead of
  // continuing wherever the previous one stopped.
  const replay = useReplay(run.result ? `${run.runId}` : null, run.isRunning);
  /**
   * One past the last stage once the verdict is in.
   *
   * The header marks a stage done when the phase is *past* it, so capping at 4
   * left the verdict permanently "in progress": it lit blue and never turned
   * green, however finished the run was.
   */
  const phase = run.result && replay.phase >= 4 ? t.phases.length : replay.phase;

  const launch = useCallback(async () => {
    setRefusal(null);
    // Refused here rather than by the server, because the server's answer would
    // be a 500: with nine angle combinations a very short E91 run can leave one
    // CHSH setting with no samples at all.
    if (!isBB84 && config.params.nQubits < MIN_E91_PAIRS) {
      setRefusal(t.tooSmallE91);
      return;
    }

    config.setSelected(null);

    const channel =
      config.params.channelKind === "ideal" ? "ideal" : `γ=${config.gamma.toFixed(3)}`;
    setStamp(
      `${config.params.protocol} · seed ${config.params.seed} · n=${config.params.nQubits.toLocaleString(locale)}` +
        ` · trials=${config.params.trials} · ${channel}` +
        (config.params.attackKind !== "none" ? ` · F=${config.params.fraction.toFixed(2)}` : ""),
    );

    try {
      await run.launch(config.apiConfig);
    } catch (error) {
      if (error instanceof ApiError) setRefusal(error.isBusy ? t.busy : error.detail);
      else setRefusal(String(error));
    }
  }, [config, isBB84, locale, run, t]);

  const reset = useCallback(() => {
    setRefusal(null);
    run.reset();
    config.reset();
  }, [config, run]);

  /**
   * Carry the reader down to the summary when the replay finishes.
   *
   * The composition of the key sits below the fold on most screens, and it is
   * the panel that says what the run actually produced — it was being missed
   * entirely. Moving it up would push the trace off instead, so the page comes
   * to it, once, at the moment there is something to see.
   */
  const done = !!run.result && replay.phase >= t.phases.length - 1;
  useEffect(() => {
    if (!done) return;
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [done, reduced]);

  const [copyFailed, setCopyFailed] = useState(false);

  const copyConfig = useCallback(async () => {
    const json = JSON.stringify(config.apiConfig, null, 2);
    if (await copyText(json)) {
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      return;
    }
    // Nothing worked, so put the text where it can be selected instead of
    // leaving a button that quietly does nothing.
    setCopyFailed(true);
  }, [config.apiConfig]);

  const topology = plugins.data?.topologies[config.params.protocol];
  const attacking = config.params.attackKind !== "none";

  const channelLabel = useMemo(() => {
    const hops = topology?.links.filter((link) => link.kind === "quantum").length ?? 1;
    if (config.params.channelKind === "ideal") return `${t.channel}: ${t.ideal}`;
    const km = lengthFromGamma(config.gamma);
    return `${t.damping} · γ ${config.gamma.toFixed(3)} · L ${km.toFixed(1)} km · ${hops}× ${(km / hops).toFixed(1)} km`;
  }, [config.gamma, config.params, t, topology]);

  const selectedRole: Role | null = config.selected
    ? ((config.selected in ROLE_COLOR ? config.selected : "relay") as Role)
    : null;

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "352px 1fr", background: "var(--bg)" }}>
      <Sidebar
        params={config.params}
        set={config.set}
        plugins={plugins.data}
        busy={run.isRunning}
        onRun={launch}
        onReset={reset}
        onCopy={() => void copyConfig()}
        copied={copied}
        copyFailed={copyFailed}
        configJson={JSON.stringify(config.apiConfig, null, 2)}
        onLoad={config.load}
      />

      <main
        ref={scroller}
        style={{ display: "flex", flexDirection: "column", minWidth: 0, maxHeight: "100vh", overflowY: "auto" }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            padding: "14px 28px",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg-2)",
            position: "sticky",
            top: 0,
            zIndex: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 11, flex: "none", whiteSpace: "nowrap" }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: "-.02em" }}>
              {isBB84 ? "BB84" : "E91"}
            </h1>
            <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
              {phase >= 4 ? t.subDone : t.subIdle}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 14,
              rowGap: 6,
              flex: "1 1 auto",
              minWidth: 0,
              justifyContent: "flex-end",
            }}
          >
            {t.phases.map((label, index) => {
              const done = phase > index;
              const now = phase === index;
              return (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: done ? "var(--mint)" : now ? "var(--blue)" : "var(--line-2)",
                      boxShadow: now ? "0 0 8px -1px var(--blue)" : "none",
                      animation: now ? "qbreath 1.6s ease-in-out infinite" : "none",
                    }}
                  />
                  <span style={{ fontSize: 12, color: done || now ? "var(--fg)" : "var(--fg-3)" }}>{label}</span>
                </div>
              );
            })}
            {[
              { to: "/explore", label: t.exploreCta },
              { to: "/compare", label: t.compareCta },
            ].map((entry) => (
              <Link
                key={entry.to}
                to={entry.to}
                style={{
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
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
                {entry.label} →
              </Link>
            ))}
          </div>
        </header>

        <NetworkDiagram
          topology={topology}
          showEve={attacking}
          running={run.isRunning}
          selected={config.selected}
          onSelect={(id) => config.setSelected(config.selected === id ? null : id)}
          channelLabel={channelLabel}
          height={DIAGRAM_HEIGHT}
        >
          {(plugins.isError || refusal || run.error) && (
            <div
              style={{
                position: "absolute",
                bottom: 14,
                left: 20,
                right: 20,
                maxWidth: 520,
                padding: "9px 13px",
                borderRadius: 10,
                border: "1px solid color-mix(in oklab, var(--red) 40%, transparent)",
                background: "color-mix(in oklab, var(--red) 12%, var(--panel))",
                color: "var(--red)",
                fontSize: 11.5,
                lineHeight: 1.5,
                zIndex: 5,
              }}
            >
              {plugins.isError ? t.backendDown : `${t.refused}: ${refusal ?? run.error}`}
            </div>
          )}

          {selectedRole && (
            <Inspector
              role={selectedRole}
              views={first?.views ?? null}
              isBB84={isBB84}
              onClose={() => config.setSelected(null)}
            />
          )}
        </NetworkDiagram>

        {/* The results area is the largest surface here, and an empty one read as
            a broken page rather than an idle one. The skeleton holds the exact
            layout that is coming, so the arrival of real data is a fill and not
            a rebuild — and it shimmers only while something is actually on its
            way. */}
        {!run.result && (
          <ResultsSkeleton
            active={run.isRunning}
            title={run.isRunning ? t.workingTitle : t.awaitingTitle}
            // While it runs, the only thing worth saying is how far along it is.
            hint={
              run.isRunning
                ? `${t.trialLabel} ${Math.min(run.trials.length + 1, config.params.trials)} / ${config.params.trials}`
                : t.awaitingHint
            }
            cards={4}
          />
        )}

        {run.result && first && (
          <Results
            result={run.result}
            trials={run.trials}
            first={first}
            isBB84={isBB84}
            nQubits={config.params.nQubits}
            threshold={config.params.qberThreshold}
            confidence={config.params.chshConfidence}
            runId={run.runId}
            stamp={stamp}
            replay={replay}
          />
        )}
      </main>
    </div>
  );
}
