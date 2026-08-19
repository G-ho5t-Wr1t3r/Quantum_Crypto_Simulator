/**
 * The house 3D look: a solid, glossy ball.
 *
 * Every node on every screen is one of these, and they are lit consistently —
 * highlight up and to the left, terminator down and to the right, a contact
 * shadow underneath. The point is that the network reads as objects standing in
 * a space rather than circles drawn on a plane, which is what makes dragging one
 * feel like moving a thing.
 *
 * The glow always has a negative spread (`0 0 Npx -Mpx COLOR`) so it reads as
 * light falling off, never as neon.
 */

import type { CSSProperties } from "react";

export function sphereStyle(color: string, d: number): CSSProperties {
  return {
    width: d,
    height: d,
    borderRadius: "50%",
    background: [
      "radial-gradient(circle at 33% 26%, rgba(255,255,255,.98) 0%, rgba(255,255,255,.5) 9%, transparent 30%)",
      `radial-gradient(circle at 42% 34%, color-mix(in oklab, ${color} 82%, white) 0%, ${color} 44%,` +
        ` color-mix(in oklab, ${color} 60%, black) 76%, color-mix(in oklab, ${color} 32%, black) 100%)`,
    ].join(", "),
    boxShadow: [
      `0 ${(d * 0.16).toFixed(1)}px ${(d * 0.3).toFixed(1)}px -${(d * 0.14).toFixed(1)}px rgba(0,0,0,.6)`,
      `0 0 ${(d * 0.5).toFixed(1)}px -${(d * 0.22).toFixed(1)}px ${color}`,
      `inset 0 -${(d * 0.16).toFixed(1)}px ${(d * 0.3).toFixed(1)}px -${(d * 0.18).toFixed(1)}px rgba(0,0,0,.55)`,
    ].join(", "),
  };
}

/** The specular highlight, sized to the ball it sits on. */
export function specularStyle(d: number): CSSProperties {
  return {
    position: "absolute",
    left: "31%",
    top: "22%",
    width: Math.max(3, d * 0.16),
    height: Math.max(2, d * 0.11),
    borderRadius: "50%",
    background: "rgba(255,255,255,.9)",
    filter: `blur(${Math.max(0.6, d * 0.012).toFixed(1)}px)`,
    pointerEvents: "none",
  };
}

export function Sphere({
  color,
  d,
  selected = false,
}: {
  color: string;
  d: number;
  selected?: boolean;
}) {
  const base = sphereStyle(color, d);
  return (
    <span
      style={{
        ...base,
        position: "relative",
        display: "block",
        boxShadow: selected
          ? `${base.boxShadow}, 0 0 0 ${Math.max(1.5, d * 0.025).toFixed(1)}px color-mix(in oklab, ${color} 55%, transparent)`
          : base.boxShadow,
      }}
    >
      <span style={specularStyle(d)} />
    </span>
  );
}
