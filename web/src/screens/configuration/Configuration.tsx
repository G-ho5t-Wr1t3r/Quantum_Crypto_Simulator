/**
 * The main tool: build the network, run it, read the result in place.
 *
 * The whiteboard does not hand over to a separate results page — it becomes the
 * simulation view where it stands, and the panels rise in underneath. The run
 * being watched is the network that was just drawn, and moving that to another
 * screen would break the connection the screen exists to make.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { usePlugins } from "../../api/queries";
import { useRun } from "../../api/useRun";
import type { ProtocolKind } from "../../api/contract";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { lengthFromGamma, MIN_E91_PAIRS } from "../../lib/physics";
import { ALL_ROLES, ROLE_COLOR } from "../../lib/roles";
import { Inspector } from "./Inspector";
import { Results } from "./Results";
import { Sidebar } from "./Sidebar";
import { useConfiguration } from "./state";
import { Whiteboard } from "./Whiteboard";

/**
 * How long each phase of the replay is held.
 *
 * The engine does not stream the phases — a trial runs synchronously and one
 * event covers the whole of it — so the interface paces preparation, transit,
 * sifting and estimation itself. The verdict is the exception: it waits for the
 * real result, however long that takes, because it is the only phase that
 * reports something rather than illustrating it.
 */
const PHASE_MS = [1500, 900, 1500, 1000];

export default function Configuration() {
  const t = useCopy();
  const locale = useLocale();
  const [search] = useSearchParams();
  const initialProtocol: ProtocolKind = search.get("protocol") === "e91" ? "e91" : "bb84";

  const plugins = usePlugins();
  const run = useRun();
  const config = useConfiguration(initialProtocol);

  const [linkMode, setLinkMode] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [phase, setPhase] = useState(-1);
  const [stamp, setStamp] = useState("");
  const timers = useRef<number[]>([]);

  const isBB84 = config.params.protocol === "bb84";

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // The verdict phase is reached by the result arriving, not by a timer.
  useEffect(() => {
    if (run.result) setPhase(PHASE_MS.length);
  }, [run.result]);

  const onSelect = useCallback(
    (id: number) => {
      if (!linkMode) {
        config.setSelected(id);
        return;
      }
      if (pending === null) {
        setPending(id);
        return;
      }
      if (pending !== id) config.connect(pending, id);
      setPending(null);
    },
    [config, linkMode, pending],
  );

  const launch = useCallback(async () => {
    setRefusal(null);
    // Refused here rather than by the server, because the server's answer would
    // be a 500: with nine angle combinations a very short E91 run can leave one
    // CHSH setting with no samples at all.
    if (!isBB84 && config.params.nQubits < MIN_E91_PAIRS) {
      setRefusal(t.tooSmallE91);
      return;
    }

    clearTimers();
    setPhase(0);
    config.setSelected(null);
    setLinkMode(false);

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

    let elapsed = 0;
    PHASE_MS.forEach((ms, index) => {
      elapsed += ms;
      timers.current.push(
        window.setTimeout(() => setPhase((current) => Math.max(current, index + 1)), elapsed),
      );
    });

    try {
      await run.launch(config.apiConfig);
    } catch (error) {
      clearTimers();
      setPhase(-1);
      if (error instanceof ApiError) setRefusal(error.isBusy ? t.busy : error.detail);
      else setRefusal(String(error));
    }
  }, [clearTimers, config, isBB84, locale, run, t]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase(-1);
    setRefusal(null);
    run.reset();
    config.setParams((current) => ({ ...current, ...{} }));
  }, [clearTimers, config, run]);

  const copyConfig = useCallback(() => {
    void navigator.clipboard?.writeText(JSON.stringify(config.apiConfig, null, 2)).catch(() => {});
    setCopied(true);
    timers.current.push(window.setTimeout(() => setCopied(false), 1800));
  }, [config.apiConfig]);

  const channelLabel = useMemo(() => {
    const hops = Math.max(1, config.links.length);
    if (config.params.channelKind === "ideal") {
      return `${t.channel}: ${t.ideal} · ${hops}×`;
    }
    const km = config.params.channelMode === "length_km" ? config.params.km : lengthFromGamma(config.gamma);
    return `${t.damping} · γ ${config.gamma.toFixed(3)} · L ${km.toFixed(1)} km · ${hops}×${(km / hops).toFixed(1)} km`;
  }, [config.gamma, config.links.length, config.params, t]);

  const selectedNode = config.nodes.find((node) => node.id === config.selected);
  const first = run.trials[0];

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "352px 1fr", background: "var(--bg)" }}>
      <Sidebar
        params={config.params}
        set={config.set}
        preset={config.preset}
        applyPreset={config.applyPreset}
        plugins={plugins.data}
        busy={run.isRunning}
        onRun={launch}
        onReset={reset}
        onCopy={copyConfig}
        copied={copied}
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
              {phase >= PHASE_MS.length ? t.subDone : t.subIdle}
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

        <Whiteboard
          nodes={config.nodes}
          links={config.links}
          selected={config.selected}
          linkMode={linkMode}
          pending={pending}
          running={run.isRunning}
          onSelect={onSelect}
          onMove={config.moveNode}
          channelLabel={channelLabel}
        >
          <div
            style={{
              position: "absolute",
              top: 18,
              left: 24,
              display: "flex",
              flexDirection: "column",
              gap: 9,
              zIndex: 4,
              maxWidth: 262,
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                padding: 4,
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "0 14px 30px -20px #000, inset 0 1px 0 var(--hi)",
              }}
            >
              {ALL_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => config.addNode(role)}
                  style={{
                    padding: "6px 10px",
                    fontSize: 11.5,
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--panel-2)",
                    color: ROLE_COLOR[role],
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    boxShadow: "inset 0 1px 0 var(--hi)",
                  }}
                >
                  + {t.roles[role]}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  setLinkMode((on) => !on);
                  setPending(null);
                  config.setSelected(null);
                }}
                style={{
                  padding: "7px 12px",
                  fontSize: 11.5,
                  border: `1px solid ${linkMode ? "transparent" : "var(--line)"}`,
                  borderRadius: 9,
                  background: linkMode ? "var(--blue)" : "var(--panel-2)",
                  color: linkMode ? "#fff" : "var(--fg-2)",
                  cursor: "pointer",
                  boxShadow: "inset 0 1px 0 var(--hi)",
                }}
              >
                {linkMode ? t.linkModeOn : t.linkMode}
              </button>
              <button
                type="button"
                onClick={() => config.applyPreset("blank")}
                style={{
                  padding: "7px 12px",
                  fontSize: 11.5,
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel-2)",
                  color: "var(--fg-2)",
                  cursor: "pointer",
                  boxShadow: "inset 0 1px 0 var(--hi)",
                }}
              >
                {t.clear}
              </button>
            </div>
            <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>
              {linkMode ? t.hintLink : t.hintIdle}
            </span>
            {plugins.isError && (
              <span style={{ fontSize: 11, color: "var(--red)", lineHeight: 1.5 }}>{t.backendDown}</span>
            )}
            {(refusal || run.error) && (
              <span style={{ fontSize: 11, color: "var(--red)", lineHeight: 1.5 }}>
                {t.refused}: {refusal ?? run.error}
              </span>
            )}
          </div>

          {selectedNode && (
            <Inspector
              role={selectedNode.role}
              views={first?.views ?? null}
              isBB84={isBB84}
              onClose={() => config.setSelected(null)}
              onRemove={() => config.removeNode(selectedNode.id)}
            />
          )}
        </Whiteboard>

        {run.result && (
          <Results
            result={run.result}
            first={first}
            isBB84={isBB84}
            nQubits={config.params.nQubits}
            threshold={config.params.qberThreshold}
            runId={run.runId}
            stamp={stamp}
          />
        )}
      </main>
    </div>
  );
}
