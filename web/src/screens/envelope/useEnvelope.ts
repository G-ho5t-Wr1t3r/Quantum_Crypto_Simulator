/**
 * The operating envelope: one sweep per fibre length, run in order.
 *
 * A single run says what happened; a sweep says how it behaves along one axis;
 * this says *where it is possible to stand at all*. Two axes, so two questions
 * answered at once: how far the fibre may go, and how much of it may be
 * listened to.
 *
 * BUILT ON THE FROZEN CONTRACT, deliberately. The engine's sweep takes one axis
 * only, but on the `attack_fraction` axis it leaves the configured channel
 * alone — so a row of the map is an ordinary sweep with `length_km` pinned in
 * the base configuration, and the map is a stack of them. No new endpoint, no
 * change to `SimulationEvent`, nothing reopened.
 *
 * Rows are run one after another rather than all at once. The server refuses
 * work above its concurrency ceiling with a 429, and firing fifteen sweeps at a
 * machine that will take some of them is a way to get an incomplete map with no
 * indication of which parts are missing.
 */

import { useCallback, useRef, useState } from "react";

import { startSweep } from "./../../api/client";
import { subscribe } from "./../../api/stream";
import type { ProtocolKind, SweepPoint } from "./../../api/contract";

export interface Row {
  km: number;
  points: SweepPoint[];
}

export interface EnvelopeRequest {
  protocol: ProtocolKind;
  lengths: number[];
  fractionSteps: number;
  qubits: number;
  seed: number;
  threshold: number;
}

/**
 * One row: a sweep over the intercepted fraction at a fixed length.
 *
 * `onPoint` fires as each cell lands rather than only at the end. The engine
 * already streams them one by one — each is a complete run — so surfacing them
 * as they arrive costs nothing and makes the map fill cell by cell, which is
 * what it is actually doing. Waiting for the row hid a minute of real progress
 * behind eight blank cells at a time.
 */
function sweepRow(
  request: EnvelopeRequest,
  km: number,
  onPoint: (point: SweepPoint) => void,
): Promise<SweepPoint[]> {
  return startSweep({
    config: {
      protocol: request.protocol,
      n_qubits: request.qubits,
      trials: 1,
      seed: request.seed,
      // Pinned here and untouched by the axis, which is the whole reason this
      // works without a two-dimensional sweep in the engine.
      channel: { kind: "amplitude_damping", length_km: km },
      attack: { kind: "intercept_resend" },
      security: { qber_threshold: request.threshold, chsh_confidence: 3 },
    },
    axis: "attack_fraction",
    start: 0,
    stop: 1,
    points: request.fractionSteps,
  }).then(
    (handle) =>
      new Promise<SweepPoint[]>((resolve, reject) => {
        const collected: SweepPoint[] = [];
        subscribe(handle.run_id, {
          onEvent: (event) => {
            if (event.kind === "sweep_point") {
              const point = event.payload as SweepPoint;
              collected.push(point);
              onPoint(point);
            }
            if (event.kind === "done") {
              const payload = event.payload as { points?: SweepPoint[] };
              resolve(payload.points ?? collected);
            }
            if (event.kind === "error") reject(new Error((event.payload as { detail: string }).detail));
          },
          onClose: (reason) => {
            if (reason) reject(new Error(reason));
          },
        });
      }),
  );
}

export function useEnvelope() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the reader asks to stop; checked between rows. */
  const abandoned = useRef(false);

  const stop = useCallback(() => {
    abandoned.current = true;
  }, []);

  const compute = useCallback(async (request: EnvelopeRequest) => {
    abandoned.current = false;
    setError(null);
    setRows([]);
    setRunning(true);
    try {
      for (const km of request.lengths) {
        if (abandoned.current) break;
        // The row is opened empty and filled in place, so a cell appears the
        // moment its run is done rather than when its neighbours are.
        setRows((current) => [...current, { km, points: [] }]);
        await sweepRow(request, km, (point) => {
          setRows((current) =>
            current.map((row) => (row.km === km ? { ...row, points: [...row.points, point] } : row)),
          );
        });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRunning(false);
    }
  }, []);

  const clear = useCallback(() => {
    setRows([]);
    setError(null);
  }, []);

  return { rows, running, error, compute, stop, clear };
}
