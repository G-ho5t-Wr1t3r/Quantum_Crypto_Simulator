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

import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { usePlugins } from "../../api/queries";
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

  const [copied, setCopied] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [stamp, setStamp] = useState("");

  const isBB84 = config.params.protocol === "bb84";
  const first = run.trials[0];

  // Keyed on the run, so a second launch replays from the beginning instead of
  // continuing wherever the previous one stopped.
  const replay = useReplay(first ? `${run.runId}` : null, run.isRunning);
  const phase = run.result && replay.phase >= 4 ? 4 : replay.phase;

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
      config.params.channelKind === "ideal"
        ? "ideal"
        : config.params.channelMode === "gamma"
          ? `γ=${config.gamma.toFixed(3)}`
          : `L=${config.params.km} km`;
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

  const copyConfig = useCallback(() => {
    void navigator.clipboard?.writeText(JSON.stringify(config.apiConfig, null, 2)).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [config.apiConfig]);

  const topology = plugins.data?.topologies[config.params.protocol];
  const attacking = config.params.attackKind !== "none";

  const channelLabel = useMemo(() => {
    const hops = topology?.links.filter((link) => link.kind === "quantum").length ?? 1;
    if (config.params.channelKind === "ideal") return `${t.channel}: ${t.ideal}`;
    const km = config.params.channelMode === "length_km" ? config.params.km : lengthFromGamma(config.gamma);
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
        onCopy={copyConfig}
        copied={copied}
        onLoad={config.load}
      />

      <main style={{ display: "flex", flexDirection: "column", minWidth: 0, maxHeight: "100vh", overflowY: "auto" }}>
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
        {!first && (
          <ResultsSkeleton
            active={run.isRunning}
            title={run.isRunning ? t.workingTitle : t.awaitingTitle}
            hint={run.isRunning ? t.workingHint : t.awaitingHint}
            cards={4}
          />
        )}

        {first && (
          <Results
            result={run.result}
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
