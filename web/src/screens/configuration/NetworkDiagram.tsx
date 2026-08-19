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
 * The camera is a pinhole over a ground plane, so a node further away is
 * genuinely smaller and higher. It reads as a network standing in a space
 * rather than circles on a plane.
 */

import { useLayoutEffect, useRef, useState } from "react";

import { Sphere } from "../../components/Sphere";
import { useReducedMotion } from "../../app/appearance";
import { useCopy } from "../../i18n/useCopy";
import { clamp } from "../../lib/physics";
import { ROLE_COLOR, type Role } from "../../lib/roles";
import type { Topology, TopologyLink } from "../../api/contract";

const HORIZON = 0.24;
/**
 * How the ground plane is compressed into the frame.
 *
 * Shallower than a walk-through scene would use, on purpose: the job here is to
 * read the wiring at a glance, and strong recession makes the far participant
 * small and crowds everything towards the centre. Everyone who matters stands
 * at the same depth, so they are the same size and the chain reads across.
 */
const NEAR = 3.4;
const DEPTH = 2.6;
const NODE_D = 96;
/** Where a link attaches: the middle of a node's disc, not its footprint. */
const ATTACH = 58;

/** How far the classical link bows away from the quantum one, in pixels. */
const CLASSICAL_BOW = 130;

/** The depth every participant shares, so none of them is dwarfed. */
const ROW = 0.6;
/** How far in front of that row an eavesdropper stands. */
const EVE_FORWARD = 0.22;

/**
 * Where each participant stands.
 *
 * Fixed per identity rather than computed, because these are the same four
 * roles in every run and a layout that reshuffles between protocols would make
 * the two look like different systems. An unknown id — a protocol added later —
 * is spread along the front rather than dropped.
 */
const ACROSS: Record<string, number> = {
  alice: 0.12,
  bob: 0.88,
  source: 0.5,
  relay: 0.5,
};

/** A quadratic curve between two points, bowed towards the viewer. */
function arc(x1: number, y1: number, x2: number, y2: number, bow: number): string {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 + bow;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

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
      // A step towards the viewer, so she is plainly on that segment rather
      // than behind whatever else stands near it.
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

  const project = (u: number, v: number) => {
    const z = NEAR + (1 - v) * DEPTH;
    const x = (u - 0.5) * 6;
    return {
      x: width / 2 + (x / z) * width * 0.5,
      y: height * HORIZON + (1 / z) * height * 1.25,
      s: clamp(4.2 / z, 0.7, 1.15),
    };
  };

  const nodes = topology ? place(topology, showEve) : [];
  const at = new Map(nodes.map((node) => [node.id, node]));

  const links = (topology ? route(topology, showEve) : [])
    .map((link, index) => {
      const a = at.get(link.source);
      const b = at.get(link.target);
      if (!a || !b) return null;
      const pa = project(a.u, a.v);
      const pb = project(b.u, b.v);
      return {
        key: `${link.source}-${link.target}-${link.kind}-${index}`,
        kind: link.kind,
        attackable: link.attackable,
        x1: pa.x,
        y1: pa.y - ATTACH * pa.s,
        x2: pb.x,
        y2: pb.y - ATTACH * pb.s,
        s: (pa.s + pb.s) / 2,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const floor: { x1: number; y1: number; x2: number; y2: number; w: number; o: number }[] = [];
  for (let index = -10; index <= 26; index++) {
    const a = project(index / 16, -8.5);
    const b = project(index / 16, 1.06);
    floor.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: index % 4 === 0 ? 1.2 : 0.9, o: index % 4 === 0 ? 0.3 : 0.16 });
  }
  [1.06, 0.9, 0.74, 0.58, 0.42, 0.26, 0.1, -0.1, -0.4, -0.9, -2, -5].forEach((v, index) => {
    const a = project(-0.9, v);
    const b = project(1.9, v);
    floor.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      w: index % 4 === 0 ? 1.2 : 0.9,
      o: 0.06 + 0.28 * Math.pow(Math.max(0, v), 1.15),
    });
  });

  return (
    <div
      ref={host}
      style={{
        position: "relative",
        height,
        flex: "none",
        overflow: "hidden",
        background:
          "radial-gradient(90% 80% at 50% 34%, color-mix(in oklab, var(--blue) 7%, var(--sky)) 0%," +
          " var(--sky) 30%, var(--floor) 42%, var(--floor) 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "28%",
          height: "14%",
          background: "radial-gradient(60% 100% at 50% 100%, var(--horizon), transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {floor.map((line, index) => (
          <line
            key={index}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="var(--grid)"
            strokeWidth={line.w}
            opacity={line.o}
          />
        ))}

        {links.map((link) =>
          link.kind === "quantum" ? (
            // Three strokes rather than one: a blurred halo, a soft body and a
            // bright core. A single line reads as a wire; this reads as light.
            <g key={link.key}>
              <line
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                stroke="var(--blue)"
                strokeWidth={12 * link.s}
                opacity={running ? 0.3 : 0.16}
                strokeLinecap="round"
                style={{ filter: "blur(7px)" }}
              />
              <line
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                stroke="var(--blue)"
                strokeWidth={Math.max(2.4, 3.6 * link.s)}
                opacity={running ? 0.8 : 0.5}
                strokeLinecap="round"
                style={{ filter: "blur(2px)" }}
              />
              <line
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                stroke="var(--fg)"
                strokeWidth={Math.max(1, 1.5 * link.s)}
                opacity={running ? 0.95 : 0.62}
                strokeLinecap="round"
              />
            </g>
          ) : (
            // The classical link, dashed and dim, and drawn as an arc rather
            // than a straight line.
            //
            // Two reasons, and the first is a correctness one: in BB84 this
            // link joins the same two parties as the quantum one, so as a
            // straight line it lands exactly underneath it and disappears. The
            // second is that bowing it out says what it is — a separate path
            // that goes around, not a second wire in the same duct. In E91 it
            // also keeps it clear of the source standing between the two ends.
            <path
              key={link.key}
              d={arc(link.x1, link.y1, link.x2, link.y2, CLASSICAL_BOW * link.s)}
              fill="none"
              stroke="var(--fg-3)"
              strokeWidth={Math.max(1, 1.3 * link.s)}
              strokeDasharray="5 6"
              opacity={0.6}
              strokeLinecap="round"
            />
          ),
        )}
      </svg>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "42%",
          background: "linear-gradient(180deg, var(--sky) 0%, var(--sky) 62%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {running &&
        !reduced &&
        links
          .filter((link) => link.kind === "quantum")
          .map((link) => {
            const length = Math.hypot(link.x2 - link.x1, link.y2 - link.y1);
            const angle = (Math.atan2(link.y2 - link.y1, link.x2 - link.x1) * 180) / Math.PI;
            const d = Math.max(3, 5 * link.s);
            return (
              <div
                key={`pulse-${link.key}`}
                style={{
                  position: "absolute",
                  left: link.x1,
                  top: link.y1,
                  width: length,
                  height: 0,
                  transform: `rotate(${angle}deg)`,
                  transformOrigin: "0 0",
                  pointerEvents: "none",
                }}
              >
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: -d / 2,
                      width: d,
                      height: d,
                      borderRadius: "50%",
                      background: "var(--fg)",
                      boxShadow: `0 0 ${8 * link.s}px rgba(76,141,255,.55)`,
                      ["--len" as string]: `${length}px`,
                      animation: `qtravel 1.8s linear ${index * 0.45}s infinite`,
                    }}
                  />
                ))}
              </div>
            );
          })}

      {/* Sorted by depth so a nearer node occludes one behind it. */}
      {[...nodes]
        .sort((a, b) => a.v - b.v)
        .map((node) => {
          const point = project(node.u, node.v);
          const color = ROLE_COLOR[node.role];
          const active = selected === node.id;
          const d = NODE_D * point.s;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(node.id)}
              title={node.label}
              style={{
                position: "absolute",
                left: point.x,
                top: point.y,
                transform: "translate(-50%, -100%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6 * point.s,
                // A pointer, not a grab: it opens what this participant saw.
                cursor: "pointer",
                zIndex: 3 + Math.round(node.v * 10),
                border: "none",
                background: "transparent",
                padding: `0 0 ${10 * point.s}px`,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  bottom: 2 * point.s,
                  width: d * 1.15,
                  height: d * 0.3,
                  borderRadius: "50%",
                  background: "radial-gradient(50% 50% at 50% 50%, var(--shadow), transparent 72%)",
                  filter: `blur(${(2 + 2 * point.s).toFixed(1)}px)`,
                  pointerEvents: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  bottom: 2 * point.s,
                  width: d * 0.62,
                  height: d * 0.17,
                  border: `1px solid ${color}`,
                  borderRadius: "50%",
                  opacity: active ? 0.3 : 0.16,
                  pointerEvents: "none",
                }}
              />
              <Sphere color={color} d={d} selected={active} />
              <span
                style={{
                  fontSize: Math.max(10, 12 * point.s),
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--fg)" : "var(--fg-2)",
                  whiteSpace: "nowrap",
                  textShadow: "0 1px 3px var(--shadow)",
                }}
              >
                {node.label}
              </span>
            </button>
          );
        })}

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

      <div
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          display: "flex",
          flexDirection: "column",
          gap: 7,
          zIndex: 4,
          pointerEvents: "none",
        }}
      >
        {[
          { label: t.linkQuantum, dashed: false, color: "var(--blue)" },
          { label: t.linkClassical, dashed: true, color: "var(--fg-3)" },
        ].map((entry) => (
          <div key={entry.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={
                entry.dashed
                  ? { width: 16, height: 0, borderTop: `1.5px dashed ${entry.color}`, flex: "none" }
                  : { width: 16, height: 3, borderRadius: 2, background: entry.color, flex: "none" }
              }
            />
            <span style={{ fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>{entry.label}</span>
          </div>
        ))}
        <span style={{ fontSize: 10.5, color: "var(--fg-3)", maxWidth: 260, lineHeight: 1.5 }}>{t.diagramHint}</span>
      </div>

      {children}
    </div>
  );
}
