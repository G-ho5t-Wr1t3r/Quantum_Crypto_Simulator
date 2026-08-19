/**
 * What to run.
 *
 * Only the configuration lives here now. The network is no longer something the
 * reader assembles: it is derived from the protocol and the attack, and drawn
 * from the topology the backend declares. That removes a whole class of
 * confusion — a hand-built picture could disagree with the run it was supposed
 * to depict, and the picture is the thing people believe.
 */

import { useCallback, useMemo, useState } from "react";

import type { ProtocolKind, SimulationConfig } from "../../api/contract";
import { gammaFromLength } from "../../lib/physics";

export interface Params {
  protocol: ProtocolKind;
  nQubits: number;
  trials: number;
  seed: number;
  channelKind: "ideal" | "amplitude_damping";
  /**
   * The damping parameter, and the only way the channel is set here.
   *
   * γ and a fibre length are the same channel said twice, so offering a switch
   * between them was offering a choice with no consequence — and the form then
   * had to show the other number anyway, because it is the same setting. One
   * control drives γ and reads out the length beside it.
   *
   * γ is the one that drives, not the length, because its range is bounded and
   * evenly useful: 0…0.5 covers the first fifteen kilometres, which is where a
   * link either works or does not. A slider in kilometres spends most of its
   * travel above γ = 0.9, where every run fails identically.
   */
  gamma: number;
  attackKind: "none" | "intercept_resend";
  position: "channel" | "endpoint";
  fraction: number;
  qberThreshold: number;
  chshConfidence: number;
}

export const DEFAULT_PARAMS: Params = {
  protocol: "bb84",
  nQubits: 2000,
  trials: 1,
  seed: 20260818,
  channelKind: "amplitude_damping",
  gamma: 0.08,
  attackKind: "intercept_resend",
  position: "channel",
  fraction: 0.5,
  qberThreshold: 0.11,
  chshConfidence: 3,
};

export function useConfiguration(initialProtocol: ProtocolKind) {
  const [params, setParams] = useState<Params>({ ...DEFAULT_PARAMS, protocol: initialProtocol });
  const [selected, setSelected] = useState<string | null>(null);

  const set = useCallback(<K extends keyof Params>(key: K, value: Params[K]) => {
    setParams((current) => ({ ...current, [key]: value }));
  }, []);

  const reset = useCallback(() => setParams({ ...DEFAULT_PARAMS }), []);

  /** The damping actually in force; zero on an ideal line. */
  const gamma = useMemo(
    () => (params.channelKind === "ideal" ? 0 : params.gamma),
    [params],
  );

  /**
   * The body of `POST /simulate`.
   *
   * γ is sent and the length never is: the backend refuses both together, and
   * the two are the same channel, so there is nothing to lose by always naming
   * it the same way.
   *
   * The security policy carries both fields whatever the protocol, because that
   * is the shape the backend validates. Which of the two it consults is the
   * backend's business: BB84 is judged on the error rate, E91 on the Bell
   * parameter, and the interface only has to avoid *offering* the one that will
   * be ignored.
   */
  const apiConfig = useMemo<SimulationConfig>(() => {
    const channel =
      params.channelKind === "ideal"
        ? ({ kind: "ideal" } as const)
        : ({ kind: "amplitude_damping", gamma: Number(params.gamma.toFixed(4)) } as const);

    return {
      protocol: params.protocol,
      n_qubits: params.nQubits,
      trials: params.trials,
      seed: params.seed,
      channel,
      attack:
        params.attackKind === "none"
          ? { kind: "none" }
          : {
              kind: params.attackKind,
              position: params.position,
              fraction: Number(params.fraction.toFixed(2)),
            },
      security: {
        qber_threshold: Number(params.qberThreshold.toFixed(3)),
        chsh_confidence: params.chshConfidence,
      },
    };
  }, [params]);

  /**
   * Adopt a configuration that came from outside — the JSON of a previous run.
   *
   * The counterpart of copying it out, and the reason both exist: a figure in
   * the report can name the exact run that produced it, and that run can be
   * played back here rather than reconstructed by hand from a caption.
   *
   * Unknown or missing fields keep their current value instead of resetting the
   * form: a partial paste should move what it mentions and leave the rest.
   */
  const load = useCallback((raw: string): boolean => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!parsed || typeof parsed !== "object") return false;

    const body = parsed as Partial<SimulationConfig>;
    const channel = body.channel;
    const attack = body.attack;
    const security = body.security;

    const isProtocol = body.protocol === "bb84" || body.protocol === "e91";
    const number = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? value : fallback;

    setParams((current) => ({
      ...current,
      protocol: isProtocol ? body.protocol! : current.protocol,
      nQubits: number(body.n_qubits, current.nQubits),
      trials: number(body.trials, current.trials),
      seed: number(body.seed, current.seed),
      channelKind: channel?.kind === "ideal" || channel?.kind === "amplitude_damping" ? channel.kind : current.channelKind,
      // A pasted configuration may describe the channel either way, because the
      // backend accepts both. A length is converted rather than refused: it is
      // the same channel, and rejecting a valid body would be pedantry.
      gamma:
        channel?.length_km != null
          ? gammaFromLength(channel.length_km)
          : number(channel?.gamma, current.gamma),
      attackKind:
        attack?.kind === "none" || attack?.kind === "intercept_resend" ? attack.kind : current.attackKind,
      position: attack?.position === "endpoint" || attack?.position === "channel" ? attack.position : current.position,
      fraction: number(attack?.fraction, current.fraction),
      qberThreshold: number(security?.qber_threshold, current.qberThreshold),
      chshConfidence: number(security?.chsh_confidence, current.chshConfidence),
    }));
    return true;
  }, []);

  return { params, set, reset, load, selected, setSelected, gamma, apiConfig };
}
