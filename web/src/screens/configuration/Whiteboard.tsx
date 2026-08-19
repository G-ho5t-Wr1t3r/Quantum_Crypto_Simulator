/**
 * The network whiteboard: the run drawn as objects standing in a space.
 *
 * The camera is a pinhole over a ground plane rather than a flat 2D canvas.
 * Nodes are positioned in (u, v) — across and towards the viewer — and the
 * projection gives back a screen point plus a scale, so a node further away is
 * genuinely smaller and sits higher. That is what lets the topology read as a
 * network with depth instead of circles on a plane, and it is why dragging
 * uses the inverse projection: the pointer moves the node across the floor,
 * not across the screen.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Sphere } from "../../components/Sphere";
import { useCopy } from "../../i18n/useCopy";
import { clamp } from "../../lib/physics";
import { ROLE_COLOR, ROLE_GLYPH } from "../../lib/roles";
import type { Link, Node } from "./state";

const HORIZON = 0.28;
const NEAR = 2.2;
const DEPTH = 6.9;
const NODE_D = 78;
/** Where a link attaches: the middle of a node's disc, not its footprint. */
const ATTACH = 49;

export interface Camera {
  project: (u: number, v: number) => { x: number; y: number; s: number };
  unproject: (px: number, py: number) => { u: number; v: number };
  width: number;
  height: number;
}

export function useCamera(width: number, height: number): Camera {
  return {
    width,
    height,
    project: (u, v) => {
      const z = NEAR + (1 - v) * DEPTH;
      const x = (u - 0.5) * 6;
      return {
        x: width / 2 + (x / z) * width * 0.5,
        y: height * HORIZON + (1 / z) * height * 1.364,
        s: clamp(3.05 / z, 0.68, 1.12),
      };
    },
    unproject: (px, py) => {
      const z = clamp((height * 1.364) / Math.max(6, py - height * HORIZON), NEAR, NEAR + DEPTH);
      const x = ((px - width / 2) * z) / (width * 0.5);
      return { u: x / 6 + 0.5, v: 1 - (z - NEAR) / DEPTH };
    },
  };
}

/** The perspective floor: lines converging towards the horizon. */
function FloorGrid({ camera }: { camera: Camera }) {
  const lines: { x1: number; y1: number; x2: number; y2: number; w: number; o: number }[] = [];
  for (let i = -10; i <= 26; i++) {
    const u = i / 16;
    const a = camera.project(u, -8.5);
    const b = camera.project(u, 1.06);
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: i % 4 === 0 ? 1.2 : 0.9, o: i % 4 === 0 ? 0.32 : 0.17 });
  }
  // Spaced so that they crowd towards the horizon the way real recession does.
  [1.06, 0.94, 0.82, 0.7, 0.58, 0.46, 0.34, 0.22, 0.1, -0.04, -0.22, -0.5, -0.95, -1.8, -3.6, -8.5].forEach(
    (v, index) => {
      const a = camera.project(-0.9, v);
      const b = camera.project(1.9, v);
      lines.push({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        w: index % 4 === 0 ? 1.2 : 0.9,
        o: 0.07 + 0.3 * Math.pow(Math.max(0, v), 1.15),
      });
    },
  );
  return (
    <>
      {lines.map((line, index) => (
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
    </>
  );
}

export interface DrawnLink {
  from: { x: number; y: number; s: number };
  to: { x: number; y: number; s: number };
  label: string;
}

export function Whiteboard({
  nodes,
  links,
  selected,
  linkMode,
  pending,
  running,
  onSelect,
  onMove,
  channelLabel,
  children,
}: {
  nodes: Node[];
  links: Link[];
  selected: number | null;
  linkMode: boolean;
  pending: number | null;
  running: boolean;
  onSelect: (id: number) => void;
  onMove: (id: number, u: number, v: number) => void;
  channelLabel: string;
  children?: React.ReactNode;
}) {
  const t = useCopy();
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 960, h: 520 });
  const camera = useCamera(size.w, size.h);
  const drag = useRef<{ id: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Listening on the window rather than the node: a pointer that leaves the
  // small target mid-drag should keep dragging, which is what a physical object
  // would do.
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = drag.current;
      const element = host.current;
      if (!active || !element) return;
      const box = element.getBoundingClientRect();
      const { u, v } = camera.unproject(event.clientX - box.left, event.clientY - box.top);
      active.moved = true;
      onMove(active.id, clamp(u, 0.05, 0.95), clamp(v, 0.08, 0.95));
    };
    const onPointerUp = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [camera, onMove]);

  const byId = new Map(nodes.map((node) => [node.id, node]));

  const drawn = links
    .map((link) => {
      const a = byId.get(link.a);
      const b = byId.get(link.b);
      if (!a || !b) return null;
      const pa = camera.project(a.x, a.y);
      const pb = camera.project(b.x, b.y);
      return {
        key: `${link.a}-${link.b}`,
        x1: pa.x,
        y1: pa.y - ATTACH * pa.s,
        x2: pb.x,
        y2: pb.y - ATTACH * pb.s,
        s: (pa.s + pb.s) / 2,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const handleClick = useCallback(
    (id: number) => {
      // A drag that ends over the node is not a click on it.
      if (drag.current?.moved) return;
      onSelect(id);
    },
    [onSelect],
  );

  return (
    <div
      ref={host}
      style={{
        flex: "1 1 auto",
        minHeight: 420,
        position: "relative",
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
          top: "26%",
          height: "14%",
          background: "radial-gradient(60% 100% at 50% 100%, var(--horizon), transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <FloorGrid camera={camera} />
        {drawn.map((link) => (
          <g key={link.key}>
            {/* Three strokes rather than one: a blurred halo, a soft body and a
                bright core. A single line reads as a wire; this reads as light. */}
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
        ))}
      </svg>

      {/* The sky, painted over the grid so the floor stops at the horizon. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "44%",
          background: "linear-gradient(180deg, var(--sky) 0%, var(--sky) 62%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      {running &&
        drawn.map((link) => {
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
        .sort((a, b) => a.y - b.y)
        .map((node) => {
          const point = camera.project(node.x, node.y);
          const color = ROLE_COLOR[node.role];
          const active = selected === node.id || pending === node.id;
          const d = NODE_D * point.s;
          return (
            <div
              key={node.id}
              onPointerDown={() => {
                drag.current = { id: node.id, moved: false };
              }}
              onClick={() => handleClick(node.id)}
              title={ROLE_GLYPH[node.role]}
              style={{
                position: "absolute",
                left: point.x,
                top: point.y,
                transform: "translate(-50%, -100%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6 * point.s,
                cursor: drag.current?.id === node.id ? "grabbing" : "grab",
                zIndex: 3 + Math.round(node.y * 10),
                touchAction: "none",
                paddingBottom: 10 * point.s,
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
                {t.roles[node.role]}
              </span>
            </div>
          );
        })}

      {/* One reading for the whole path. Per-segment labels collide the moment
          two hops share a node, and the channel is configured once anyway. */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
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

      {linkMode && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "2px dashed color-mix(in oklab, var(--blue) 40%, transparent)",
            pointerEvents: "none",
          }}
        />
      )}

      {children}
    </div>
  );
}
