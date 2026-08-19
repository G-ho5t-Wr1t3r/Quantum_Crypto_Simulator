/**
 * Pacing the replay of a trial.
 *
 * The engine does not stream a run position by position, and it should not: a
 * trial runs synchronously with its qubits simulated one at a time in
 * density-matrix mode, so an event per qubit would put more traffic on the
 * channel than there is physics in it. What it sends instead is the whole set
 * of per-participant views in one message.
 *
 * So the build-up on screen is a **replay**, driven here, of data that has
 * already arrived. It is worth being exact about that: nothing is being watched
 * live. What the pacing buys is that the reader sees Alice prepare, the qubits
 * cross, Bob measure and the two compare, in that order — which is the order
 * that makes the numbers underneath mean something.
 *
 * The clock starts when the first trial lands, not when the run is launched,
 * because before that there is nothing to reveal.
 */

import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "../../app/appearance";

/** Milliseconds each stage of the replay occupies. */
const STAGE_MS = [1500, 900, 1500, 1000];
const TOTAL_MS = STAGE_MS.reduce((total, ms) => total + ms, 0);

export interface Replay {
  /** Which stage is running: 0…3, or 4 once the verdict is in. */
  phase: number;
  /** How much of each row has been revealed, 0…1. */
  alice: number;
  eve: number;
  bob: number;
  sifting: number;
  /** Whether the aggregate readouts have come in yet. */
  estimate: number;
}

const FINISHED: Replay = { phase: 4, alice: 1, eve: 1, bob: 1, sifting: 1, estimate: 1 };
const IDLE: Replay = { phase: -1, alice: 0, eve: 0, bob: 0, sifting: 0, estimate: 0 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ramp = (elapsed: number, from: number, to: number) => clamp01((elapsed - from) / (to - from));

function at(elapsed: number): Replay {
  const [transmit, measure, sift, estimate] = STAGE_MS as [number, number, number, number];
  const t0 = 0;
  const t1 = t0 + transmit;
  const t2 = t1 + measure;
  const t3 = t2 + sift;
  const t4 = t3 + estimate;

  return {
    phase: elapsed < t1 ? 0 : elapsed < t2 ? 1 : elapsed < t3 ? 2 : elapsed < t4 ? 3 : 4,
    alice: ramp(elapsed, t0, t1),
    // Lagging Alice by a quarter of the stage: an eavesdropper acts on a qubit
    // after it is sent and before it arrives, and showing her row filling in
    // step with Alice's would place her outside the transit she sits in.
    eve: ramp(elapsed, t0 + transmit * 0.25, t1 + transmit * 0.25),
    bob: ramp(elapsed, t1, t2),
    sifting: ramp(elapsed, t2, t3),
    estimate: ramp(elapsed, t3, t4),
  };
}

/**
 * @param key changes whenever a new trial should be replayed; null while there
 *   is nothing to show.
 * @param live true while the run itself is still in flight, which keeps the
 *   first phase lit before any data has arrived.
 */
export function useReplay(key: string | null, live: boolean): Replay {
  const reduced = useReducedMotion();
  const [state, setState] = useState<Replay>(IDLE);
  const frame = useRef(0);

  useEffect(() => {
    if (key === null) {
      setState(live ? { ...IDLE, phase: 0 } : IDLE);
      return;
    }
    // Somebody who asked for less movement gets the finished picture, not a
    // slower version of the same animation.
    if (reduced) {
      setState(FINISHED);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      setState(at(elapsed));
      if (elapsed < TOTAL_MS) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [key, live, reduced]);

  return state;
}

/** How many of `total` positions are revealed at a given fraction. */
export function revealed(total: number, fraction: number): number {
  return Math.max(0, Math.min(total, Math.round(total * fraction)));
}
