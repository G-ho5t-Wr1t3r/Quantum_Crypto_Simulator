/**
 * The network, drawn from the topology the backend declares.
 *
 * It is a depiction, not a canvas: nothing here can be dragged, added or
 * rewired. That is deliberate. The picture's job is to show *the run that is
 * configured*, and a hand-assembled diagram could disagree with it — which
 * matters, because the picture is the part people believe.
 *
 * Everything on screen comes from `/plugins`: who the participants are, what
 * connects them, and which of those links an attacker can sit on. Adding a
 * protocol to the backend therefore adds it here too, with no change on this
 * side.
 *
 * SEEN FROM ABOVE, and only from above. A perspective version existed and was
 * dropped: recession makes the far participant smaller for no reason anyone
 * needs, and the atmosphere it takes to sell the depth — a sky band, a horizon
 * glow, blurred halos on every line — turns into haze that eats the very
 * channels the diagram is about. In plan there is nothing to sell: two links of
 * the same length look the same length, nothing hides behind anything, and the
 * lines are just lines.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { Sphere } from "../../components/Sphere";
import { useReducedMotion } from "../../app/appearance";
import { useCopy } from "../../i18n/useCopy";
import { ROLE_COLOR, type Role } from "../../lib/roles";
import type { Topology, TopologyLink } from "../../api/contract";

/** Margin around the drawing, so nothing touches the frame. */
const PAD = 92;
/** How far apart the depth axis spreads. */
const SPREAD = 300;
const NODE_D = 76;
/** Spacing of the lattice behind everything. */
const GRID = 44;
/** How far the classical link arcs away from the chain. */
const CLASSICAL_BOW = 120;

/** The row every participant shares, so the chain reads as a line. */
const ROW = 0.6;
/** How far off that row an eavesdropper stands, towards the viewer. */
const EVE_FORWARD = 0.22;

/**
 * Where each participant stands, across the frame.
 *
 * Fixed per identity rather than computed, because these are the same few roles
 * in every run and a layout that reshuffled between protocols would make the
 * two look like different systems.
 *
 * Eve is not here. She is placed from the link she breaks — see `place`.
 */
const ACROSS: Record<string, number> = {
  alice: 0.12,
  bob: 0.88,
  source: 0.5,
  relay: 0.5,
};

export interface Placed {
  id: string;
  label: string;
  role: Role;
  u: number;
  v: number;
}

export function place(topology: Topology, showEve: boolean): Placed[] {
  const shown = topology.nodes.filter((node) => (node.id === "eve" ? showEve : true));
  const others = shown.filter((node) => node.id !== "eve");

  const placed: Placed[] = others.map((node, index) => ({
    id: node.id,
    label: node.label,
    role: (node.id in ROLE_COLOR ? node.id : "relay") as Role,
    u: ACROSS[node.id] ?? 0.2 + (0.6 * index) / Math.max(1, others.length - 1),
    v: ROW,
  }));

  const eve = shown.find((node) => node.id === "eve");
  if (eve) {
    // On the arm she breaks, not in the middle of the picture.
    //
    // In E91 the attackable link is source→Alice, and standing her at the
    // centre put her in the same column as the source: the diagram then read as
    // "Alice is connected to Eve, Bob to the source", which is not the run. A
    // diagram is believed, so it has to be right about this.
    const broken = topology.links.find((link) => link.attackable);
    const from = placed.find((node) => node.id === broken?.source);
    const to = placed.find((node) => node.id === broken?.target);
    placed.push({
      id: eve.id,
      label: eve.label,
      role: "eve",
      u: from && to ? (from.u + to.u) / 2 : 0.5,
      v: ROW + EVE_FORWARD,
    });
  }

  return placed;
}

/**
 * The links to draw, with Eve spliced into the one she can act on.
 *
 * An eavesdropper is not a node beside the line; she is a break in it. Drawing
 * her sitting next to an intact link would say the qubits still travel straight
 * from one end to the other, which is exactly what an intercept-resend is not.
 */
export function route(topology: Topology, showEve: boolean): TopologyLink[] {
  if (!showEve) return topology.links;
  const attackable = topology.links.find((link) => link.attackable);
  if (!attackable) return topology.links;
  return topology.links.flatMap((link) =>
    link === attackable
      ? [
          { ...link, target: "eve" },
          { ...link, source: "eve" },
        ]
      : [link],
  );
}

/** A quadratic curve between two points, bowed away from the chain. */
function arc(x1: number, y1: number, x2: number, y2: number, bow: number): string {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 + bow;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** A point on that curve, and the direction it is heading there. */
function onArc(x1: number, y1: number, x2: number, y2: number, bow: number, at: number) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 + bow;
  const t = at;
  const x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2;
  const y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2;
  const dx = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx);
  const dy = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * A leader line from a channel to its name.
 *
 * The two channels are the one thing about a QKD topology a reader has to get
 * right immediately — which line can be attacked and which is assumed
 * authenticated — and colour alone does not say it. A label with a line to the
 * thing it names does, and it survives being screenshotted into a slide where
 * nobody has the legend.
 *
 * The elbow turns outward from the centre of the frame, so the text always runs
 * into open space rather than over whoever is standing in the middle.
 */
interface Callout {
  anchor: { x: number; y: number };
  path: string;
  label: { x: number; y: number; align: "left" | "right" };
}

function callout(x: number, y: number, width: number, up: boolean): Callout {
  const toLeft = x < width * 0.5;
  const dx = (toLeft ? -1 : 1) * 46;
  const dy = (up ? -1 : 1) * 52;
  const tail = (toLeft ? -1 : 1) * 18;
  return {
    anchor: { x, y },
    path: `M ${x.toFixed(1)} ${y.toFixed(1)} L ${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)} L ${(x + dx + tail).toFixed(1)} ${(y + dy).toFixed(1)}`,
    label: { x: x + dx + tail, y: y + dy, align: toLeft ? "right" : "left" },
  };
}

export function NetworkDiagram({
  topology,
  showEve,
  running,
  selected,
  onSelect,
  channelLabel,
  height,
  children,
}: {
  topology: Topology | undefined;
  showEve: boolean;
  running: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  channelLabel: string;
  height: number;
  children?: React.ReactNode;
}) {
  const t = useCopy();
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const project = (u: number, v: number) => ({
    x: PAD + u * (width - 2 * PAD),
    // Centred on the row everyone shares. Further towards the viewer is further
    // down the screen, which is what puts the eavesdropper below the line she
    // is standing on rather than above it.
    y: height / 2 + (v - ROW) * SPREAD,
  });

  const nodes = topology ? place(topology, showEve) : [];
  const at = new Map(nodes.map((node) => [node.id, node]));

  const links = (topology ? route(topology, showEve) : [])
    .map((link, index) => {
      const a = at.get(link.source);
      const b = at.get(link.target);
      if (!a || !b) return null;
      const from = project(a.u, a.v);
      const to = project(b.u, b.v);
      return {
        key: `${link.source}-${link.target}-${link.kind}-${index}`,
        kind: link.kind,
        attackable: link.attackable,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        length: Math.hypot(to.x - from.x, to.y - from.y),
        angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const quantum = links.filter((link) => link.kind === "quantum");
  const classical = links.filter((link) => link.kind === "classical");

  const longest = (of: typeof links) => [...of].sort((a, b) => b.length - a.length)[0];
  const quantumLink = longest(quantum);
  const classicalLink = longest(classical);

  const labels: { key: string; text: string; color: string; callout: Callout }[] = [];
  if (quantumLink) {
    // A third of the way along, rather than the middle: the middle of a quantum
    // link is where Eve stands.
    labels.push({
      key: "quantum",
      text: t.linkQuantum,
      color: "var(--blue)",
      callout: callout(
        quantumLink.x1 + (quantumLink.x2 - quantumLink.x1) * 0.34,
        quantumLink.y1 + (quantumLink.y2 - quantumLink.y1) * 0.34,
        width,
        false,
      ),
    });
  }
  if (classicalLink) {
    const apex = onArc(
      classicalLink.x1,
      classicalLink.y1,
      classicalLink.x2,
      classicalLink.y2,
      -CLASSICAL_BOW,
      0.5,
    );
    labels.push({
      key: "classical",
      text: t.linkClassical,
      color: "var(--amber)",
      callout: callout(apex.x, apex.y, width, true),
    });
  }

  return (
    <div
      ref={host}
      style={{
        position: "relative",
        height,
        flex: "none",
        overflow: "hidden",
        background: "radial-gradient(120% 100% at 50% 50%, color-mix(in oklab, var(--blue) 5%, var(--sky)) 0%, var(--sky) 70%)",
      }}
    >
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <defs>
          {/* The travelling particle: bright at the head, fading behind it.
              A symmetrical dot moves without saying which way. */}
          <linearGradient id="qkd-comet" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--fg)" stopOpacity={0} />
            <stop offset="70%" stopColor="var(--blue)" stopOpacity={0.75} />
            <stop offset="100%" stopColor="var(--fg)" stopOpacity={1} />
          </linearGradient>
        </defs>

        {/* An even lattice: no convergence, so a distance read anywhere on it
            means the same thing. */}
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

        {classical.map((link) => (
          <g key={link.key}>
            <path
              d={arc(link.x1, link.y1, link.x2, link.y2, -CLASSICAL_BOW)}
              fill="none"
              stroke="var(--amber)"
              strokeWidth={2.6}
              opacity={0.9}
              strokeLinecap="round"
            />
          </g>
        ))}

        {quantum.map((link) => (
          <g key={link.key}>
            <line
              x1={link.x1}
              y1={link.y1}
              x2={link.x2}
              y2={link.y2}
              stroke="var(--blue)"
              strokeWidth={4}
              opacity={running ? 0.7 : 0.45}
              strokeLinecap="round"
              style={{ transition: "opacity .4s ease" }}
            />
            <line
              x1={link.x1}
              y1={link.y1}
              x2={link.x2}
              y2={link.y2}
              stroke="var(--blue)"
              strokeWidth={1.6}
              opacity={0.95}
              strokeLinecap="round"
            />
          </g>
        ))}

        {labels.map((entry) => (
          <g key={entry.key}>
            <circle cx={entry.callout.anchor.x} cy={entry.callout.anchor.y} r={3.2} fill={entry.color} />
            <circle
              cx={entry.callout.anchor.x}
              cy={entry.callout.anchor.y}
              r={7}
              fill="none"
              stroke={entry.color}
              strokeWidth={1}
              opacity={0.45}
            />
            <path d={entry.callout.path} fill="none" stroke={entry.color} strokeWidth={1.2} opacity={0.8} />
          </g>
        ))}
      </svg>

      {/* The qubits in flight, and only while they are.
          A diagram that animates when nothing is happening is telling the
          reader something is. The direction of travel is carried by the comets
          when it matters, which is during a run. */}
      {running &&
        !reduced &&
        quantum.map((link) => (
          <div
            key={`flow-${link.key}`}
            style={{
              position: "absolute",
              left: link.x1,
              top: link.y1,
              width: link.length,
              height: 0,
              transform: `rotate(${link.angle}deg)`,
              transformOrigin: "0 0",
              pointerEvents: "none",
            }}
          >
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                style={{
                  position: "absolute",
                  left: 0,
                  top: -3,
                  width: 26,
                  height: 6,
                  borderRadius: 3,
                  // A comet, not a dot: the tail is what says which way it is
                  // going even in a screenshot.
                  background: "linear-gradient(90deg, transparent, color-mix(in oklab, var(--blue) 70%, transparent) 60%, var(--fg))",
                  boxShadow: "0 0 10px -3px var(--blue)",
                  ["--len" as string]: `${link.length - 26}px`,
                  animation: `qflow 1.5s linear ${index * 0.5}s infinite`,
                }}
              />
            ))}
          </div>
        ))}

      {nodes.map((node, index) => {
        const point = project(node.u, node.v);
        const color = ROLE_COLOR[node.role];
        const active = selected === node.id;
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node.id)}
            title={node.label}
            data-testid={`node-${node.id}`}
            style={{
              position: "absolute",
              left: point.x,
              top: point.y,
              transform: "translate(-50%, -50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // A pointer, not a grab: it opens what this participant saw.
              cursor: "pointer",
              zIndex: 3,
              border: "none",
              background: "transparent",
              padding: 0,
            }}
          >
            {/* Alive while the run is.
                Each participant breathes on its own offset rather than in step
                with the others: a network of nodes doing something, not one
                light behind four holes. */}
            {running && !reduced && (
              <span
                style={{
                  position: "absolute",
                  width: NODE_D * 1.5,
                  height: NODE_D * 1.5,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, color-mix(in oklab, ${color} 55%, transparent) 0%, transparent 68%)`,
                  filter: "blur(6px)",
                  animation: `qbreath 1.8s ease-in-out ${(index * 0.22).toFixed(2)}s infinite`,
                  pointerEvents: "none",
                }}
              />
            )}

            {/* The node's outline on the ground. Seen from above there is
                nothing for a shadow to fall across, so this is what gives it a
                footprint. */}
            <span
              style={{
                position: "absolute",
                width: NODE_D * 1.34,
                height: NODE_D * 1.34,
                border: `1px solid ${color}`,
                borderRadius: "50%",
                opacity: active ? 0.35 : 0.14,
                pointerEvents: "none",
                animation: running && !reduced ? `qbreath 1.8s ease-in-out ${(index * 0.22).toFixed(2)}s infinite` : "none",
              }}
            />
            <Sphere color={color} d={NODE_D} selected={active} />
            <span
              style={{
                position: "absolute",
                top: `calc(100% + 10px)`,
                left: "50%",
                transform: "translateX(-50%)",
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--fg)" : "var(--fg-2)",
                whiteSpace: "nowrap",
              }}
            >
              {node.label}
            </span>
          </button>
        );
      })}

      {labels.map((entry) => (
        <span
          key={`label-${entry.key}`}
          className="mono"
          style={{
            position: "absolute",
            left: entry.callout.label.x,
            top: entry.callout.label.y,
            transform: `translate(${entry.callout.label.align === "right" ? "-100%" : "0"}, -50%)`,
            padding: "4px 10px",
            borderRadius: 8,
            border: `1px solid color-mix(in oklab, ${entry.color} 38%, transparent)`,
            background: "color-mix(in oklab, var(--panel) 88%, transparent)",
            backdropFilter: "blur(6px)",
            color: entry.color,
            fontSize: 10.5,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          {entry.text}
        </span>
      ))}

      {/* One reading for the whole path: the channel is configured once, and a
          label per segment would collide as soon as two hops share a node. */}
      <div
        style={{
          position: "absolute",
          bottom: 14,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 14px",
          borderRadius: 22,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          boxShadow: "0 14px 30px -22px #000, inset 0 1px 0 var(--hi)",
          pointerEvents: "none",
          zIndex: 4,
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--blue)",
            boxShadow: "0 0 7px -1px var(--blue)",
          }}
        />
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
          {channelLabel}
        </span>
      </div>

      <div style={{ position: "absolute", bottom: 14, left: 20, maxWidth: 240, zIndex: 4, pointerEvents: "none" }}>
        <span style={{ fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{t.diagramHint}</span>
      </div>

      {children}
    </div>
  );
}
