/**
 * The configuration screen's state: what to run, and how the network is drawn.
 *
 * The two are kept together because they are not independent — enabling an
 * attack has to put an Eve on an attackable link, and removing one has to take
 * her off it. A topology that disagrees with the configuration would be a
 * picture of a run nobody asked for.
 */

import { useCallback, useMemo, useState } from "react";

import type { ProtocolKind, SimulationConfig } from "../../api/contract";
import { clamp, gammaFromLength } from "../../lib/physics";
import type { Role } from "../../lib/roles";

export type ChannelMode = "gamma" | "length_km";
export type PresetId = "pair" | "eve" | "epr" | "blank" | "custom";

export interface Node {
  id: number;
  role: Role;
  /** Position on the ground plane: u across, v towards the viewer, both 0…1. */
  x: number;
  y: number;
}

export interface Link {
  a: number;
  b: number;
}

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

interface PresetShape {
  nodes: [Role, number, number][];
  links: [number, number][];
  attack: Params["attackKind"];
  protocol?: ProtocolKind;
}

export const PRESETS: Record<Exclude<PresetId, "custom">, PresetShape> = {
  pair: {
    nodes: [
      ["alice", 0.21, 0.8],
      ["bob", 0.79, 0.8],
    ],
    links: [[0, 1]],
    attack: "none",
  },
  eve: {
    nodes: [
      ["alice", 0.17, 0.7],
      ["eve", 0.5, 0.95],
      ["bob", 0.83, 0.7],
    ],
    links: [
      [0, 1],
      [1, 2],
    ],
    attack: "intercept_resend",
  },
  epr: {
    nodes: [
      ["alice", 0.18, 0.72],
      ["source", 0.5, 0.94],
      ["bob", 0.82, 0.72],
    ],
    // Both arms leave the source: that is what makes E91 a source in the middle
    // rather than a sender at one end.
    links: [
      [1, 0],
      [1, 2],
    ],
    attack: "none",
    protocol: "e91",
  },
  blank: { nodes: [], links: [], attack: "none" },
};

function build(preset: Exclude<PresetId, "custom">): { nodes: Node[]; links: Link[]; nextId: number } {
  const shape = PRESETS[preset];
  const nodes = shape.nodes.map((entry, index) => ({
    id: index + 1,
    role: entry[0],
    x: entry[1],
    y: entry[2],
  }));
  const links = shape.links.map(([a, b]) => ({ a: nodes[a]!.id, b: nodes[b]!.id }));
  return { nodes, links, nextId: nodes.length + 1 };
}

export function useConfiguration(initialProtocol: ProtocolKind) {
  const [params, setParams] = useState<Params>({ ...DEFAULT_PARAMS, protocol: initialProtocol });
  const initial = build(initialProtocol === "e91" ? "epr" : "eve");
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [links, setLinks] = useState<Link[]>(initial.links);
  const [nextId, setNextId] = useState(initial.nextId);
  const [preset, setPreset] = useState<PresetId>(initialProtocol === "e91" ? "epr" : "eve");
  const [selected, setSelected] = useState<number | null>(null);

  const applyPreset = useCallback((id: Exclude<PresetId, "custom">) => {
    const built = build(id);
    setNodes(built.nodes);
    setLinks(built.links);
    setNextId(built.nextId);
    setPreset(id);
    setSelected(null);
    setParams((current) => ({
      ...current,
      attackKind: PRESETS[id].attack,
      protocol: PRESETS[id].protocol ?? current.protocol,
    }));
  }, []);

  /**
   * Keep the drawing honest when the attack is switched on or off.
   *
   * Turning it on splices an Eve into the first link, so the picture shows an
   * attacker standing on something attackable. Turning it off removes her and
   * rejoins what she was standing between, rather than leaving the path broken.
   */
  const syncAttacker = useCallback((enabled: boolean) => {
    setNodes((currentNodes) => {
      const eve = currentNodes.find((node) => node.role === "eve");
      if (enabled === !!eve) return currentNodes;

      if (enabled) {
        setLinks((currentLinks) => {
          const first = currentLinks[0];
          if (!first) return currentLinks;
          return [
            ...currentLinks.slice(1),
            { a: first.a, b: nextId },
            { a: nextId, b: first.b },
          ];
        });
        const first = links[0];
        const a = currentNodes.find((node) => node.id === first?.a);
        const b = currentNodes.find((node) => node.id === first?.b);
        if (!a || !b) return currentNodes;
        let u = (a.x + b.x) / 2;
        // Keep clear of the neighbours she would otherwise stand in front of.
        for (const neighbour of [a, b]) {
          if (Math.abs(u - neighbour.x) < 0.13) u += u >= neighbour.x ? 0.17 : -0.17;
        }
        setNextId((id) => id + 1);
        return [
          ...currentNodes,
          {
            id: nextId,
            role: "eve" as Role,
            x: clamp(u, 0.1, 0.9),
            y: Math.min(0.95, Math.max(a.y, b.y) + 0.1),
          },
        ];
      }

      const gone = eve!.id;
      setLinks((currentLinks) => {
        const neighbours = currentLinks
          .filter((link) => link.a === gone || link.b === gone)
          .map((link) => (link.a === gone ? link.b : link.a));
        const rest = currentLinks.filter((link) => link.a !== gone && link.b !== gone);
        const rejoin =
          neighbours.length === 2 &&
          !rest.some(
            (link) =>
              (link.a === neighbours[0] && link.b === neighbours[1]) ||
              (link.a === neighbours[1] && link.b === neighbours[0]),
          )
            ? [{ a: neighbours[0]!, b: neighbours[1]! }]
            : [];
        return [...rest, ...rejoin];
      });
      setSelected(null);
      return currentNodes.filter((node) => node.id !== gone);
    });
  }, [links, nextId]);

  const set = useCallback(
    <K extends keyof Params>(key: K, value: Params[K]) => {
      setParams((current) => ({ ...current, [key]: value }));
      if (key === "attackKind") syncAttacker(value !== "none");
    },
    [syncAttacker],
  );

  const addNode = useCallback((role: Role) => {
    setNodes((current) => [
      ...current,
      { id: nextId, role, x: 0.34 + Math.random() * 0.32, y: 0.6 + Math.random() * 0.3 },
    ]);
    setNextId((id) => id + 1);
    setPreset("custom");
  }, [nextId]);

  const removeNode = useCallback((id: number) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setLinks((current) => current.filter((link) => link.a !== id && link.b !== id));
    setSelected(null);
    setPreset("custom");
  }, []);

  const moveNode = useCallback((id: number, x: number, y: number) => {
    setNodes((current) =>
      current.map((node) => (node.id === id ? { ...node, x, y } : node)),
    );
  }, []);

  const connect = useCallback((a: number, b: number) => {
    setLinks((current) =>
      current.some((link) => (link.a === a && link.b === b) || (link.a === b && link.b === a))
        ? current
        : [...current, { a, b }],
    );
    setPreset("custom");
  }, []);

  /** The damping parameter actually in force, whichever way it was described. */
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

  return {
    params,
    set,
    setParams,
    nodes,
    links,
    preset,
    selected,
    setSelected,
    applyPreset,
    addNode,
    removeNode,
    moveNode,
    connect,
    gamma,
    apiConfig,
  };
}
