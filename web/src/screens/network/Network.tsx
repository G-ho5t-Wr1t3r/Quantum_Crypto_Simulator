/**
 * The network extension: one run across a route, and the comparison the whole
 * feature exists for.
 *
 * Two sections, not one. The top half is a single configured run — pick a
 * strategy, a route, how many relays are compromised, and watch the key
 * either arrive, leak, or get dropped by distance. The bottom half holds the
 * question that single run cannot answer by itself: at the *same* number of
 * compromised relays, how does a trusted chain compare to splitting across
 * disjoint paths? That needs two sweeps run back to back under one axis, which
 * is why it is its own control rather than a second reading of the run above.
 */

import { useCallback, useState } from "react";

import { ApiError } from "../../api/client";
import type { NetworkSimulationConfig, NetworkStrategyKind, ProtocolKind } from "../../api/contract";
import { useNetworkRun } from "../../api/useNetworkRun";
import { TopBarControls } from "../../components/ScreenTabs";
import { Chip, Kicker, Panel, RunButton, Segmented, Slider } from "../../components/controls";
import { Banner } from "../../components/Banner";
import { ChartSkeleton, ReadoutsSkeleton } from "../../components/Skeleton";
import { LineChart, type SeriesSpec } from "../../components/LineChart";
import { rollSeed, SeedField } from "../../components/SeedField";
import { useCopy } from "../../i18n/useCopy";
import { NetworkGraph } from "./NetworkGraph";
import { startNetworkSweep } from "../../api/client";
import { subscribe } from "../../api/stream";
import type { NetworkSweepPoint } from "../../api/contract";
import { chainNetworkConfig, comparisonBound, relayCountFor, splitNetworkConfig } from "./topology";

const DIAGRAM_HEIGHT = 300;

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/**
 * The comparison sweep, run outside `useNetworkRun`.
 *
 * It launches *two* sweeps — one per strategy — against the same axis and
 * reads both to completion before anything is drawn, because a chart that
 * filled in one series before the other existed would look, for a few
 * seconds, like a run that only has one answer.
 */
function useComparison() {
  const t = useCopy();
  const [chain, setChain] = useState<NetworkSweepPoint[] | null>(null);
  const [split, setSplit] = useState<NetworkSweepPoint[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runOne = (config: NetworkSimulationConfig, stop: number): Promise<NetworkSweepPoint[]> =>
    new Promise((resolve, reject) => {
      startNetworkSweep({ config, axis: "compromised", start: 0, stop, points: stop + 1 })
        .then((handle) => {
          const sub = subscribe(handle.run_id, {
            onEvent: (event) => {
              if (event.kind === "done") {
                const payload = event.payload as unknown as { points: NetworkSweepPoint[] };
                if ("points" in payload) resolve(payload.points);
              }
              if (event.kind === "error") reject(new Error((event.payload as { detail: string }).detail));
            },
            onClose: (reason) => {
              if (reason) reject(new Error(reason));
            },
          });
          return sub;
        })
        .catch(reject);
    });

  /**
   * Takes two complete, independent configurations rather than one base
   * patched into two variants.
   *
   * The previous version derived both from whichever configuration the run
   * panel currently held, overriding only `topology` and `strategy`. While the
   * panel was in chain mode that base already had `paths: 1` baked in — chain
   * forces it — so the derived split config silently inherited a fan with one
   * path, which the backend correctly refuses: "a fan with one route is a
   * chain under another name". The fix is not a better override, it is not
   * sharing a base at all: each config is built fresh, by the caller, from the
   * fields each topology actually needs.
   */
  const run = useCallback(
    async (chainConfig: NetworkSimulationConfig, splitConfig: NetworkSimulationConfig, maxCompromised: number) => {
      if (maxCompromised < 1) {
        setError(t.networkCompareNeedsRelay);
        return;
      }
      setIsRunning(true);
      setError(null);
      setChain(null);
      setSplit(null);
      try {
        const chainPoints = await runOne(chainConfig, maxCompromised);
        setChain(chainPoints);
        const splitPoints = await runOne(splitConfig, maxCompromised);
        setSplit(splitPoints);
      } catch (error) {
        setError(error instanceof ApiError ? error.detail : (error as Error).message);
      } finally {
        setIsRunning(false);
      }
    },
    [t],
  );

  return { chain, split, isRunning, error, run };
}

export default function Network() {
  const t = useCopy();
  const run = useNetworkRun();
  const comparison = useComparison();

  const [protocol, setProtocol] = useState<ProtocolKind>("bb84");
  const [strategy, setStrategy] = useState<NetworkStrategyKind>("relay_chain");
  const [relays, setRelays] = useState(2);
  const [paths, setPaths] = useState(2);
  const [hopLength, setHopLength] = useState(4);
  const [qubits, setQubits] = useState(1000);
  const [compromisedCount, setCompromisedCount] = useState(1);
  const [seed, setSeed] = useState(rollSeed);
  const [refusal, setRefusal] = useState<string | null>(null);

  const isSplit = strategy === "split_paths";
  const maxCompromised = relayCountFor(strategy, relays, paths);
  /**
   * Clamped once, here, rather than only where the slider displays it.
   *
   * `relays` can drop after `compromisedCount` was raised against a bigger
   * network, and the state holding the raw value does not fall with it. A
   * slider that only clamps its own display would still send the stale,
   * too-large number underneath — the clamp has to live where the value is
   * read, not where it is drawn.
   */
  const clampedCompromised = Math.min(compromisedCount, maxCompromised);

  const buildConfig = useCallback((): NetworkSimulationConfig => ({
    protocol,
    n_qubits: qubits,
    seed,
    network: {
      topology: isSplit ? "fan" : "chain",
      strategy,
      hop_length_km: hopLength,
      relays,
      paths: isSplit ? paths : 1,
      compromised_count: clampedCompromised,
    },
  }), [protocol, qubits, seed, isSplit, strategy, hopLength, relays, paths, clampedCompromised]);

  /**
   * The comparison's two configs, built independently of `buildConfig` and of
   * each other — see the note on `useComparison`'s `run` for why sharing a
   * base here is exactly the bug it would reintroduce. `compromised_count` is
   * left unset: the sweep sets it per point, on both.
   */
  const buildChainConfig = useCallback(
    (): NetworkSimulationConfig => ({
      protocol,
      n_qubits: qubits,
      seed,
      network: chainNetworkConfig(relays, hopLength),
    }),
    [protocol, qubits, seed, relays, hopLength],
  );

  const buildSplitConfig = useCallback(
    (): NetworkSimulationConfig => ({
      protocol,
      n_qubits: qubits,
      seed,
      network: splitNetworkConfig(relays, paths, hopLength),
    }),
    [protocol, qubits, seed, relays, paths, hopLength],
  );

  const launch = useCallback(async () => {
    setRefusal(null);
    try {
      await run.launch(buildConfig());
    } catch (error) {
      setRefusal(error instanceof ApiError ? error.detail : (error as Error).message);
    }
  }, [run, buildConfig]);

  /**
   * The shared bound for both sweeps is the chain's own relay count, not the
   * split's.
   *
   * A split with `paths` routes has `relays * paths` relays, strictly more
   * than the chain's `relays`. Sweeping past the chain's count on the chain's
   * own network asks it to compromise relays it does not have — the backend
   * refuses that, correctly. The chain is always the tighter network, so its
   * count is also the right question to ask: "at the same number of
   * compromised relays" only has an answer up to the smaller side.
   */
  const runCompare = useCallback(() => {
    void comparison.run(buildChainConfig(), buildSplitConfig(), comparisonBound(relays));
  }, [comparison, buildChainConfig, buildSplitConfig, relays]);

  const busy = run.isRunning;
  const result = run.result;

  const series: SeriesSpec[] = [];
  if (comparison.chain) {
    series.push({
      key: "chain",
      label: t.networkSeriesChain,
      color: "var(--amber)",
      width: 2.4,
      values: comparison.chain.map((point) => point.leaked_fraction),
    });
  }
  if (comparison.split) {
    series.push({
      key: "split",
      label: t.networkSeriesSplit,
      color: "var(--mint)",
      width: 2.4,
      values: comparison.split.map((point) => point.leaked_fraction),
    });
  }
  const xs = (comparison.chain ?? comparison.split ?? []).map((point) => point.value);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 20, gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Kicker>{t.networkKicker}</Kicker>
        <TopBarControls />
      </div>

      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>
        <Panel style={{ width: 300, flex: "none", padding: 16, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
          <span style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5 }}>{t.networkIntro}</span>

          <Segmented
            wide
            label={t.protocol}
            options={[
              { id: "bb84" as const, label: "BB84" },
              { id: "e91" as const, label: "E91" },
            ]}
            value={protocol}
            onChange={setProtocol}
            disabled={busy}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Kicker>{t.networkStrategy}</Kicker>
            <Segmented
              wide
              options={[
                { id: "relay_chain" as const, label: t.strategyChain },
                { id: "split_paths" as const, label: t.strategySplit },
              ]}
              value={strategy}
              onChange={setStrategy}
              disabled={busy}
            />
          </div>

          <Slider
            label={t.networkRelays}
            display={String(relays)}
            hint={t.networkRelaysHint}
            min={0}
            max={6}
            step={1}
            value={relays}
            onChange={setRelays}
            disabled={busy}
          />

          {isSplit && (
            <Slider
              label={t.networkPaths}
              display={String(paths)}
              hint={t.networkPathsHint}
              min={2}
              max={4}
              step={1}
              value={paths}
              onChange={setPaths}
              disabled={busy}
            />
          )}

          <Slider
            label={t.networkHopLength}
            display={`${hopLength.toFixed(1)} km`}
            hint={t.networkHopLengthHint}
            min={1}
            max={7}
            step={0.5}
            value={hopLength}
            onChange={setHopLength}
            disabled={busy}
          />

          <Slider
            label={t.networkQubits}
            display={String(qubits)}
            min={200}
            max={4000}
            step={200}
            value={qubits}
            onChange={setQubits}
            disabled={busy}
          />

          <Slider
            label={t.networkCompromised}
            display={String(clampedCompromised)}
            hint={t.networkCompromisedHint}
            min={0}
            max={Math.max(1, maxCompromised)}
            step={1}
            value={clampedCompromised}
            onChange={setCompromisedCount}
            disabled={busy || maxCompromised < 1}
          />

          <SeedField value={seed} onChange={setSeed} disabled={busy} />

          <RunButton label={t.networkRun} stopLabel={t.networkStop} busy={busy} onClick={launch} onStop={run.cancel} />

          {refusal && <Banner tone="error">{refusal}</Banner>}
        </Panel>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, minWidth: 0, overflowY: "auto" }}>
          <NetworkGraph network={result?.network ?? run.started?.network} outcomes={result?.routes} height={DIAGRAM_HEIGHT} />

          {busy && !result ? (
            <ReadoutsSkeleton active count={4} />
          ) : result ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Chip color={result.delivered ? "var(--mint)" : "var(--fg-3)"}>
                {result.delivered ? t.networkDelivered : t.networkDropped}
              </Chip>
              <Chip color={result.leaked_fraction > 0 ? "var(--red)" : "var(--mint)"}>
                {t.networkLeaked}: {pct(result.leaked_fraction)}
              </Chip>
              <Chip color="var(--blue)">
                {t.networkKeyBits}: {result.key_bits}
              </Chip>
              <Chip color="var(--amber)">
                {t.networkWorstHop}: {(result.worst_hop_qber * 100).toFixed(1)}%
              </Chip>
              <Chip color="var(--fg-2)">
                {t.networkTotalLength}: {result.total_length_km.toFixed(1)} km
              </Chip>
            </div>
          ) : null}

          <Panel style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <Kicker>{t.networkCompareKicker}</Kicker>
            <span style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5 }}>{t.networkCompareBody}</span>
            <div>
              <RunButton label={t.networkCompareRun} busy={comparison.isRunning} onClick={runCompare} />
            </div>
            {comparison.error && <Banner tone="error">{comparison.error}</Banner>}

            {comparison.isRunning && series.length === 0 ? (
              <ChartSkeleton active height={360} />
            ) : series.length > 0 ? (
              <LineChart
                xs={xs}
                series={series}
                xDomain={[0, Math.max(1, xs[xs.length - 1] ?? 1)]}
                yMax={1}
                yTicks={[0, 0.25, 0.5, 0.75, 1]}
                formatY={(value) => pct(value)}
                formatX={(value) => String(Math.round(value))}
                rule={{ value: 1, label: "100%" }}
                crossing={null}
                formatCrossing={(value) => pct(value)}
                xTitle={t.networkChartXTitle}
                yTitle={t.networkChartYTitle}
                title={t.networkChartTitle}
                subtitle={t.networkChartSubtitle}
                runLabel={t.networkRunLabel}
                width={640}
                acceptFill="var(--mint)"
              />
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
