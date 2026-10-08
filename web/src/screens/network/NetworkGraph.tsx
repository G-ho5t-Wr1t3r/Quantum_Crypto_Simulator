/**
 * The route, drawn as a graph rather than as the two-node wiring diagrams
 * `NetworkDiagram` draws for a single protocol.
 *
 * It exists because that component's layout is fixed per role — Alice on the
 * left, Bob on the right, Eve on the one arm she can break — and a multi-hop
 * route has an arbitrary number of relays, and in the split strategy several
 * of them side by side. The two diagrams share the same visual language
 * (Sphere, the role colours, the grid field) on purpose: this is the same
 * network, seen at the scale a route needs rather than the scale one hop
 * needs.
 *
 * Alice is always the source and Bob the target — the backend names them that
 * way regardless of which side of the simulator they are drawn from — so the
 * two screens read as the same two participants throughout.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { Sphere } from "../../components/Sphere";
import { ROLE_COLOR } from "../../lib/roles";
import type { NetworkGraph as NetworkGraphData, RouteOutcome } from "../../api/contract";

const PAD = 70;
const NODE_D = 58;
const GRID = 40;

interface PlacedNode {
  id: string;
  label: string;
  compromised: boolean;
  u: number;
  v: number;
}

interface PlacedLink {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Red once the route it belongs to has been read by the adversary. */
  status: "idle" | "clean" | "observed" | "dropped";
}

export function NetworkGraph({
  network,
  outcomes,
  height,
}: {
  network: NetworkGraphData | undefined;
  /** The run's verdict per route, once one has happened. Colours the links. */
  outcomes?: RouteOutcome[];
  height: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const compromised = new Set<string>(outcomes?.flatMap((route) => route.compromised_relays) ?? []);

  const project = (u: number, v: number) => ({
    x: PAD + u * (width - 2 * PAD),
    y: PAD + v * (height - 2 * PAD),
  });

  const placedNodes = network
    ? Array.from(
        new Map(
          network.routes.flatMap((route, routeIndex) => {
            const v = network.routes.length === 1 ? 0.5 : 0.18 + (0.64 * routeIndex) / Math.max(1, network.routes.length - 1);
            return route.nodes.map((id, index): [string, PlacedNode] => [
              id,
              {
                id,
                label: id === network.source || id === network.target ? id : id.toUpperCase(),
                compromised: compromised.has(id),
                u: route.nodes.length === 1 ? 0.5 : index / (route.nodes.length - 1),
                v,
              },
            ]);
          }),
        ).values(),
      )
    : [];

  const at = new Map(placedNodes.map((node) => [node.id, node]));

  const routeStatus = (routeIndex: number): "idle" | "clean" | "observed" | "dropped" => {
    const outcome = outcomes?.[routeIndex];
    if (!outcome) return "idle";
    if (!outcome.delivered) return "dropped";
    return outcome.observed ? "observed" : "clean";
  };

  const links: PlacedLink[] =
    network?.routes.flatMap((route, routeIndex) => {
      const status = routeStatus(routeIndex);
      return route.hops.map((hop, hopIndex) => {
        const a = at.get(hop.source);
        const b = at.get(hop.target);
        if (!a || !b) return null;
        const from = project(a.u, a.v);
        const to = project(b.u, b.v);
        return {
          key: `${routeIndex}-${hopIndex}`,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          status,
        };
      });
    }).filter((value): value is PlacedLink => value !== null) ?? [];

  const STATUS_COLOR: Record<PlacedLink["status"], string> = {
    idle: "var(--blue)",
    clean: "var(--mint)",
    observed: "var(--red)",
    dropped: "var(--fg-3)",
  };

  return (
    <div
      ref={host}
      style={{
        position: "relative",
        height,
        flex: "none",
        overflow: "hidden",
        borderRadius: 14,
        border: "1px solid var(--line)",
        background: "radial-gradient(120% 100% at 50% 50%, color-mix(in oklab, var(--blue) 5%, var(--sky)) 0%, var(--sky) 70%)",
      }}
    >
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: Math.ceil(width / GRID) + 1 }, (_, index) => (
          <line
            key={`gx-${index}`}
            x1={index * GRID}
            y1={0}
            x2={index * GRID}
            y2={height}
            stroke="var(--grid)"
            strokeWidth={1}
            opacity={0.1}
          />
        ))}
        {Array.from({ length: Math.ceil(height / GRID) + 1 }, (_, index) => (
          <line
            key={`gy-${index}`}
            x1={0}
            y1={index * GRID}
            x2={width}
            y2={index * GRID}
            stroke="var(--grid)"
            strokeWidth={1}
            opacity={0.1}
          />
        ))}

        {links.map((link) => (
          <line
            key={link.key}
            x1={link.x1}
            y1={link.y1}
            x2={link.x2}
            y2={link.y2}
            stroke={STATUS_COLOR[link.status]}
            strokeWidth={link.status === "observed" ? 4 : 3}
            strokeDasharray={link.status === "dropped" ? "5 5" : undefined}
            opacity={link.status === "idle" ? 0.5 : 0.85}
            strokeLinecap="round"
          />
        ))}
      </svg>

      {placedNodes.map((node) => {
        const point = project(node.u, node.v);
        const isEndpoint = node.id === network?.source || node.id === network?.target;
        const color = node.compromised
          ? "var(--red)"
          : isEndpoint
            ? ROLE_COLOR[node.id === network?.source ? "alice" : "bob"]
            : ROLE_COLOR.relay;
        return (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: point.x,
              top: point.y,
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Sphere color={color} d={isEndpoint ? NODE_D : NODE_D * 0.72} selected={node.compromised} />
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                fontWeight: isEndpoint ? 600 : 500,
                color: node.compromised ? "var(--red)" : "var(--fg-2)",
                whiteSpace: "nowrap",
              }}
            >
              {node.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
