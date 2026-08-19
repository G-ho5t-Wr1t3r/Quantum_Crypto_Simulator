/**
 * The hook that owns one run: start it, follow it, expose what has arrived.
 *
 * It keeps trials and sweep points as they land rather than waiting for the
 * final aggregate, because that is the point of streaming: the error rate and
 * the Bell parameter should be visible building up, not appear at the end.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { startRun, startSweep } from "./client";
import type {
  AnyEvent,
  RunResult,
  SimulationConfig,
  StartedPayload,
  SweepPoint,
  SweepRequest,
  TrialResult,
} from "./contract";
import { subscribe, type Subscription } from "./stream";

export interface RunView {
  runId: string | null;
  /** What the run announced about itself before producing anything. */
  started: StartedPayload | null;
  trials: TrialResult[];
  points: SweepPoint[];
  /** The aggregate, once the run is over. Null while it is still going. */
  result: RunResult | null;
  isRunning: boolean;
  error: string | null;
}

const EMPTY: RunView = {
  runId: null,
  started: null,
  trials: [],
  points: [],
  result: null,
  isRunning: false,
  error: null,
};

export function useRun() {
  const [view, setView] = useState<RunView>(EMPTY);
  const subscription = useRef<Subscription | null>(null);

  // A run left following after the component goes away would keep a socket open
  // and call setState on something unmounted.
  useEffect(() => () => subscription.current?.close(), []);

  const follow = useCallback((runId: string) => {
    subscription.current?.close();
    setView({ ...EMPTY, runId, isRunning: true });

    subscription.current = subscribe(runId, {
      onEvent: (event: AnyEvent) => {
        setView((current) => reduce(current, event));
      },
      onClose: (reason) => {
        setView((current) =>
          // A close with a reason is a failure; a clean close after the run is
          // over is just the socket doing what it said it would.
          reason ? { ...current, isRunning: false, error: reason } : { ...current, isRunning: false },
        );
      },
    });
  }, []);

  const launch = useCallback(
    async (config: SimulationConfig) => {
      const handle = await startRun(config);
      follow(handle.run_id);
      return handle;
    },
    [follow],
  );

  const launchSweep = useCallback(
    async (request: SweepRequest) => {
      const handle = await startSweep(request);
      follow(handle.run_id);
      return handle;
    },
    [follow],
  );

  const reset = useCallback(() => {
    subscription.current?.close();
    subscription.current = null;
    setView(EMPTY);
  }, []);

  return { ...view, launch, launchSweep, follow, reset };
}

/**
 * Fold one event into the view.
 *
 * Written as a pure function so that the accumulation can be reasoned about —
 * and tested — without a socket. The order of events is guaranteed by the
 * backend, which records them in a list and replays that list.
 */
function reduce(view: RunView, event: AnyEvent): RunView {
  switch (event.kind) {
    case "started":
      return { ...view, started: event.payload as StartedPayload };

    case "trial":
      return { ...view, trials: [...view.trials, event.payload as TrialResult] };

    case "sweep_point":
      return { ...view, points: [...view.points, event.payload as SweepPoint] };

    case "done": {
      const payload = event.payload as RunResult | { points: SweepPoint[] };
      // A sweep and a single run end with different payloads: one carries the
      // whole curve, the other the aggregate over trials.
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
