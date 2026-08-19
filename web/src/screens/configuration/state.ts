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

export type ChannelMode = "gamma" | "length_km";

export interface Params {
  protocol: ProtocolKind;
  nQubits: number;
  trials: number;
  seed: number;
  channelKind: "ideal" | "amplitude_damping";
  channelMode: ChannelMode;
  gamma: number;
  km: number;
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
  channelMode: "gamma",
  gamma: 0.08,
  km: 25,
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

  /** The damping actually in force, whichever way it was described. */
  const gamma = useMemo(
    () =>
      params.channelKind === "ideal"
        ? 0
        : params.channelMode === "gamma"
          ? params.gamma
          : gammaFromLength(params.km),
    [params],
  );

  /**
   * The body of `POST /simulate`.
   *
   * Exactly one of γ and length_km is ever sent: the backend rejects both, and
   * sending the one the reader did not choose would silently rewrite what they
   * asked for.
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
        : params.channelMode === "gamma"
          ? ({ kind: "amplitude_damping", gamma: Number(params.gamma.toFixed(4)) } as const)
          : ({ kind: "amplitude_damping", length_km: params.km } as const);

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
      // Whichever of the two descriptions the JSON used is the one the form
      // then shows, so a run configured in kilometres comes back in kilometres.
      channelMode:
        channel?.length_km != null ? "length_km" : channel?.gamma != null ? "gamma" : current.channelMode,
      gamma: number(channel?.gamma, current.gamma),
      km: number(channel?.length_km, current.km),
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
