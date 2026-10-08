/**
 * The network counterpart of `useRun`: owns one multi-hop run or sweep.
 *
 * Kept separate rather than folded into `useRun` because the payloads differ
 * at every event — a route outcome is not a trial, a network sweep point
 * carries a leaked fraction instead of a QBER — and a reducer that branched on
 * which kind of run it was looking at would be harder to read than two small
 * ones.
 *
 * The transport underneath is the same socket as every other run: the backend
 * does not distinguish a point-to-point run from a multi-hop one once it has
 * an id, so `subscribe` and `cancelRun` are reused as they are.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { cancelRun, startNetworkRun, startNetworkSweep } from "./client";
import type {
  AnyEvent,
  NetworkResult,
  NetworkSimulationConfig,
  NetworkStartedPayload,
  NetworkSweepPoint,
  NetworkSweepRequest,
  RouteOutcome,
} from "./contract";
import { subscribe, type Subscription } from "./stream";

export interface NetworkRunView {
  runId: string | null;
  started: NetworkStartedPayload | null;
  routes: RouteOutcome[];
  points: NetworkSweepPoint[];
  result: NetworkResult | null;
  isRunning: boolean;
  error: string | null;
}

const EMPTY: NetworkRunView = {
  runId: null,
  started: null,
  routes: [],
  points: [],
  result: null,
  isRunning: false,
  error: null,
};

export function useNetworkRun() {
  const [view, setView] = useState<NetworkRunView>(EMPTY);
  const subscription = useRef<Subscription | null>(null);
  const viewRef = useRef<string | null>(null);

  useEffect(() => () => subscription.current?.close(), []);

  const follow = useCallback((runId: string) => {
    subscription.current?.close();
    viewRef.current = runId;
    setView({ ...EMPTY, runId, isRunning: true });

    subscription.current = subscribe(runId, {
      onEvent: (event: AnyEvent) => {
        setView((current) => reduce(current, event));
      },
      onClose: (reason) => {
        setView((current) =>
          reason ? { ...current, isRunning: false, error: reason } : { ...current, isRunning: false },
        );
      },
    });
  }, []);

  const launch = useCallback(
    async (config: NetworkSimulationConfig) => {
      setView({ ...EMPTY, isRunning: true });
      try {
        const handle = await startNetworkRun(config);
        follow(handle.run_id);
        return handle;
      } catch (error) {
        setView(EMPTY);
        throw error;
      }
    },
    [follow],
  );

  const launchSweep = useCallback(
    async (request: NetworkSweepRequest) => {
      setView({ ...EMPTY, isRunning: true });
      try {
        const handle = await startNetworkSweep(request);
        follow(handle.run_id);
        return handle;
      } catch (error) {
        setView(EMPTY);
        throw error;
      }
    },
    [follow],
  );

  const cancel = useCallback(() => {
    const id = viewRef.current;
    if (id) void cancelRun(id).catch(() => {});
    subscription.current?.close();
    setView((current) => ({ ...current, isRunning: false }));
  }, []);

  const reset = useCallback(() => {
    subscription.current?.close();
    subscription.current = null;
    setView(EMPTY);
  }, []);

  return { ...view, launch, launchSweep, follow, cancel, reset };
}

/**
 * `AnyEvent` fixes each payload to the point-to-point shapes; a network run
 * sends the same envelope — same `kind` values — with a route-shaped payload
 * instead. The cast goes through `unknown` because the two payload shapes do
 * not overlap, which is exactly why this reducer exists rather than reusing
 * `useRun`'s.
 */
function reduce(view: NetworkRunView, event: AnyEvent): NetworkRunView {
  switch (event.kind) {
    case "started":
      return { ...view, started: event.payload as unknown as NetworkStartedPayload };

    case "trial":
      return { ...view, routes: [...view.routes, event.payload as unknown as RouteOutcome] };

    case "sweep_point":
      return { ...view, points: [...view.points, event.payload as unknown as NetworkSweepPoint] };

    case "done": {
      const payload = event.payload as unknown as NetworkResult | { points: NetworkSweepPoint[] };
      if ("points" in payload) {
        return { ...view, points: payload.points, isRunning: false };
      }
      return { ...view, result: payload, isRunning: false };
    }

    case "error":
      return {
        ...view,
        isRunning: false,
        error: (event.payload as { detail: string }).detail,
      };
  }
}
