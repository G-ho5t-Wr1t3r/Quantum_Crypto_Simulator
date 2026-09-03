/**
 * The animation stage behind the landing copy.
 *
 * Nothing here runs on a clock. Every element is a pure function of the scroll
 * position, so the story can be read forwards, backwards, or stopped halfway,
 * and the picture always matches the paragraph beside it. That is also what
 * makes the reduced-motion story easy: the beats are already static states, and
 * only the self-running parts — photon travel, the turning globe — need to stop.
 *
 * The order of the beats is the argument the page is making: a state that cannot
 * be copied, a measurement that collapses it, a channel, two parties, an
 * eavesdropper, a network, a planet.
 */

import { Globe } from "./Globe";
import type { Beats } from "./beats";

const SPHERE_GRADIENTS = [
  { id: "qb-blue", stops: ["#e8f1ff", "#79aaff", "#2f6fe0", "#153a86", "#0a1f4a"] },
  { id: "qb-mint", stops: ["#e7fff1", "#7fe0a6", "#33a765", "#186139", "#0c3421"] },
  { id: "qb-red", stops: ["#ffeceb", "#ff9b93", "#dd4a41", "#8a221d", "#4a110e"] },
  { id: "qb-purple", stops: ["#f3ecff", "#c3a6f5", "#8a63d8", "#4c2f8c", "#2a1852"] },
];

/** A deterministic pseudo-random, so the scene is the same on every reload. */
const rnd = (index: number): number => {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

interface SphereSpec {
  role: string;
  cx: number;
  cy: number;
  d: number;
  alpha: number;
  label?: string;
}

export function Stage({
  beats,
  width,
  height,
  dark,
  reduced,
}: {
  beats: Beats;
  width: number;
  height: number;
  dark: boolean;
  reduced: boolean;
}) {
  const cx = width * 0.68;
  const cy = height * 0.5;
  const radius = Math.min(width * 0.46, height * 0.82);
  const spark = dark ? "#e6efff" : "#1b4fa8";
  const beamCore = dark ? "#fff" : "#0b3f86";
  const alpha = 1 - beats.fade;

  // --- 01–02, the vortex and its collapse -----------------------------------
  const vortexAlpha = (1 - Math.pow(beats.collapse, 0.55)) * alpha;
  const vortexScale = lerp(0.55, 1.14, ease(beats.grow)) * (1 - 0.9 * ease(beats.collapse));

  // --- 02, the points spiralling inwards ------------------------------------
  const spiral = ease(beats.implode);
  const points = Array.from({ length: 14 }, (_, index) => {
    const direction = index % 2 ? 1 : -1;
    const angle0 = (index / 14) * Math.PI * 2 + rnd(index) * 0.6;
    const radius0 = radius * (0.46 + 0.26 * rnd(index + 60));
    const angle = angle0 + spiral * 3.1 * direction;
    const distance = lerp(radius0, radius * 0.015, spiral);
    return {
      index,
      angle,
      angle0,
      direction,
      distance,
      x: cx + Math.cos(angle) * distance,
      y: cy + Math.sin(angle) * distance * 0.82,
    };
  });
  const spiralAlpha = clamp01((beats.collapse + 0.15) * 1.6) * (1 - clamp01(beats.point * 1.4)) * alpha;

  // --- the single white point everything narrows to -------------------------
  const pointDiameter = Math.max(4, radius * 0.035 * lerp(1, 1.5, beats.point));
  const dotOpacity = clamp01(beats.point * 3) * (1 - beats.pair) * alpha;

  // --- 03–05, the channel and the parties on it -----------------------------
  const half = Math.min(width * 0.26, radius * 0.58);
  const beamHalf = half * ease(beats.fibre);
  // Hard-zeroed rather than faded: by the planet beat nothing of the pair should
  // remain, and a ghost of it behind the Earth would read as a bug.
  const gone = 1 - clamp01(beats.earth * 2);
  const beamAlpha = alpha * gone;

  // --- 07–08, the planet ----------------------------------------------------
  const earthFull = Math.min(height * 0.78, width * 0.44) * lerp(0.35, 1, ease(beats.earth));
  const earthDiameter = lerp(earthFull, pointDiameter, ease(beats.earthOut));
  const earthAlpha = clamp01(beats.earth * 1.6) * alpha;
  const spinBoost = 1 + 7 * ease(beats.earthOut);

  const spheres: SphereSpec[] = [];
  const pairAlpha = beats.pair * alpha * gone;
  const pairDiameter = lerp(20, 104, ease(beats.pair));
  const add = (role: string, x: number, y: number, d: number, a: number, label?: string) => {
    if (a <= 0.02 || d < 8) return;
    spheres.push({ role, cx: x, cy: y, d, alpha: a, label });
  };
  add("qb-blue", cx - half, cy, pairDiameter, pairAlpha, "Alice");
  add("qb-mint", cx + half, cy, pairDiameter, pairAlpha, "Bob");
  add(
    "qb-red",
    cx,
    cy + lerp(height * 0.26, height * 0.17, ease(beats.eve)),
    lerp(16, 78, ease(beats.eve)),
    beats.eve * alpha * gone,
    "Eve",
  );
  const photonsVisible = beats.fibre > 0.55 && beats.earth < 0.3 && !reduced;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        height: "100vh",
        overflow: "hidden",
        zIndex: 1,
        background: "radial-gradient(90% 80% at 68% 46%, color-mix(in oklab, var(--blue) 8%, var(--bg)) 0%, var(--bg) 62%)",
      }}
    >
      {earthAlpha > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            width: earthDiameter,
            height: earthDiameter,
            margin: `${-earthDiameter / 2}px 0 0 ${-earthDiameter / 2}px`,
            opacity: earthAlpha,
            filter: `drop-shadow(0 0 ${(earthDiameter * 0.12).toFixed(0)}px rgba(76,141,255,${dark ? 0.35 : 0.18}))`,
            pointerEvents: "none",
          }}
        >
          <Globe dark={dark} spinBoost={spinBoost} />
        </div>
      )}

      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <defs>
          {SPHERE_GRADIENTS.map((gradient) => (
            <radialGradient key={gradient.id} id={gradient.id} cx="36%" cy="28%" r="74%">
              {gradient.stops.map((color, index) => (
                <stop key={color} offset={`${[0, 26, 62, 88, 100][index]}%`} stopColor={color} />
              ))}
            </radialGradient>
          ))}
          <radialGradient id="qb-hi" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.85} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* The trailing arcs the spiralling points leave behind. */}
        {spiralAlpha > 0.04 &&
          points.map((point) => {
            const arc: string[] = [];
            for (let step = 0; step <= 30; step++) {
              const u = step / 30;
              const angle = lerp(point.angle, point.angle0 + spiral * 3.1 * point.direction - point.direction * 2.4, u);
              const distance = lerp(point.distance, Math.min(radius * 0.78, point.distance + radius * 0.42), u);
              arc.push(`${(cx + Math.cos(angle) * distance).toFixed(1)} ${(cy + Math.sin(angle) * distance * 0.82).toFixed(1)}`);
            }
            return (
              <path
                key={`trail-${point.index}`}
                d={`M ${arc.join(" L ")}`}
                fill="none"
                stroke={point.index % 3 === 0 ? "var(--blue)" : "var(--purple)"}
                strokeWidth={1.1 - (point.index % 3) * 0.15}
                opacity={spiralAlpha * 0.3}
                strokeLinecap="round"
                style={{ filter: "blur(1.1px)" }}
              />
            );
          })}

        {/* The fibre: a blurred halo, a soft body, a bright core. */}
        {beamHalf > 6 && (
          <>
            <line x1={cx - beamHalf} y1={cy} x2={cx + beamHalf} y2={cy} stroke="var(--blue)" strokeWidth={16} opacity={0.18 * beamAlpha} strokeLinecap="round" style={{ filter: "blur(9px)" }} />
            <line x1={cx - beamHalf} y1={cy} x2={cx + beamHalf} y2={cy} stroke="var(--blue)" strokeWidth={4.5} opacity={0.5 * beamAlpha} strokeLinecap="round" style={{ filter: "blur(2px)" }} />
            <line x1={cx - beamHalf} y1={cy} x2={cx + beamHalf} y2={cy} stroke={beamCore} strokeWidth={1.7} opacity={0.9 * beamAlpha} strokeLinecap="round" />
          </>
        )}

        {/* Filaments twisting along it: the superposition, not a decoration. */}
        {beamHalf > 20 &&
          beamAlpha > 0.05 &&
          Array.from({ length: 6 }, (_, index) => {
            const amplitude = (8 + index * 6) * (0.45 + 0.55 * beats.fibre) * (radius / 620);
            const frequency = 1.1 + index * 0.34;
            const phase = index * 1.05;
            const arc: string[] = [];
            for (let step = 0; step <= 44; step++) {
              const u = step / 44;
              const envelope = Math.sin(Math.PI * u);
              arc.push(
                `${lerp(cx - beamHalf, cx + beamHalf, u).toFixed(1)} ${(cy + Math.sin(u * Math.PI * 2 * frequency + phase) * amplitude * envelope).toFixed(1)}`,
              );
            }
            return (
              <path
                key={`filament-${index}`}
                d={`M ${arc.join(" L ")}`}
                fill="none"
                stroke={index % 2 ? "var(--purple)" : "var(--blue)"}
                strokeWidth={1.5 - index * 0.12}
                opacity={beamAlpha * (0.5 - index * 0.05)}
                strokeLinecap="round"
                style={{ filter: index > 3 ? "blur(2.5px)" : "blur(.6px)" }}
              />
            );
          })}

        {spheres.map((sphere, index) => {
          const r = sphere.d / 2;
          return (
            <g key={`${sphere.role}-${index}`} opacity={sphere.alpha}>
              <ellipse cx={sphere.cx} cy={sphere.cy + r * 1.16} rx={r * 0.82} ry={r * 0.18} fill="#000" opacity={0.42} style={{ filter: "blur(6px)" }} />
              <circle cx={sphere.cx} cy={sphere.cy} r={r * 1.45} fill={`url(#${sphere.role})`} opacity={0.3} style={{ filter: "blur(10px)" }} />
              <circle cx={sphere.cx} cy={sphere.cy} r={r} fill={`url(#${sphere.role})`} />
              <ellipse cx={sphere.cx - r * 0.3} cy={sphere.cy - r * 0.38} rx={r * 0.42} ry={r * 0.3} fill="url(#qb-hi)" />
            </g>
          );
        })}
      </svg>

      {/* The vortex: DOM rather than SVG, because each ring is an independently
          rotating element and CSS does that for free. */}
      {vortexAlpha > 0.02 && (
        <div style={{ position: "absolute", left: cx, top: cy, width: 0, height: 0, opacity: vortexAlpha, pointerEvents: "none" }}>
          {Array.from({ length: 22 }, (_, index) => {
            const base = lerp(74, 210, rnd(index)) * (radius / 620);
            const scaleX = 0.28 + rnd(index + 11) * 0.9;
            const scaleY = 0.28 + rnd(index + 21) * 0.9;
            const rotation = rnd(index + 31) * 180;
            const duration = (11 + rnd(index + 41) * 24).toFixed(1);
            const color = dark
              ? ["#4c8dff", "#b45cff", "#ff3d8b", "#ff8a2b", "#ffffff"][index % 5]!
              : ["#1667d4", "#6f4fbf", "#c4382f", "#9b6410", "#3a3a44"][index % 5]!;
            const offsetX = (rnd(index + 51) - 0.5) * base * 0.7;
            const offsetY = (rnd(index + 61) - 0.5) * base * 0.7;
            const d = base * 2 * vortexScale;
            return (
              <span
                key={index}
                style={{
                  position: "absolute",
                  left: offsetX * vortexScale,
                  top: offsetY * vortexScale,
                  width: d,
                  height: d,
                  margin: `${-d / 2}px 0 0 ${-d / 2}px`,
                  borderRadius: "50%",
                  border: `${(1.6 - (index % 3) * 0.4).toFixed(1)}px solid ${color}`,
                  opacity: 0.72 - index * 0.016,
                  boxShadow: `0 0 ${6 + (index % 4) * 4}px -2px ${color}`,
                  transform: `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
                  animation: reduced ? "none" : `${index % 2 ? "qring" : "qringrev"} ${duration}s linear infinite`,
                  filter: `blur(${index % 4 === 0 ? 0.2 : 0.9}px)`,
                  mixBlendMode: dark ? "screen" : "multiply",
                  pointerEvents: "none",
                }}
              />
            );
          })}
          <span
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: Math.max(6, radius * 0.17 * lerp(1, 0.1, ease(beats.collapse)) * lerp(0.7, 1, ease(beats.grow))),
              height: Math.max(6, radius * 0.17 * lerp(1, 0.1, ease(beats.collapse)) * lerp(0.7, 1, ease(beats.grow))),
              transform: "translate(-50%, -50%)",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, #fff 0%, var(--purple) 34%, color-mix(in oklab, var(--red) 60%, transparent) 58%, transparent 76%)",
              filter: "blur(2px)",
              opacity: vortexAlpha * 0.9,
              animation: reduced ? "none" : "qbreath 4.5s ease-in-out infinite",
              pointerEvents: "none",
            }}
          />
        </div>
      )}

      {points.map((point) => {
        const d = lerp(3.5, 7, rnd(point.index + 70)) * lerp(1, 0.55, spiral);
        return (
          <span
            key={`particle-${point.index}`}
            style={{
              position: "absolute",
              left: point.x,
              top: point.y,
              width: d,
              height: d,
              margin: `${-d / 2}px 0 0 ${-d / 2}px`,
              borderRadius: "50%",
              background: spark,
              boxShadow: `0 0 ${(8 + 8 * (1 - spiral)).toFixed(1)}px rgba(140,180,255,${dark ? 0.85 : 0.5})`,
              opacity: spiralAlpha,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {dotOpacity > 0.01 && (
        <span
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            width: pointDiameter,
            height: pointDiameter,
            margin: `${-pointDiameter / 2}px 0 0 ${-pointDiameter / 2}px`,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: `0 0 ${(pointDiameter * 3).toFixed(1)}px ${(pointDiameter * 0.6).toFixed(1)}px rgba(160,200,255,.85)`,
            opacity: dotOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {photonsVisible && (
        <div
          style={{
            position: "absolute",
            left: cx - half,
            top: cy,
            width: half * 2,
            height: 0,
            pointerEvents: "none",
          }}
        >
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              style={{
                position: "absolute",
                left: 0,
                top: -2.5,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: beamCore,
                boxShadow: "0 0 9px 1px rgba(76,141,255,.7)",
                ["--len" as string]: `${half * 2}px`,
                animation: `qtravel 2.4s linear ${index * 0.6}s infinite`,
                opacity: beamAlpha,
              }}
            />
          ))}
        </div>
      )}

      {spheres
        .filter((sphere) => sphere.label)
        .map((sphere) => (
          <span
            key={`label-${sphere.label}`}
            style={{
              position: "absolute",
              left: sphere.cx,
              top: sphere.cy + sphere.d / 2 + 14,
              transform: "translateX(-50%)",
              fontSize: Math.max(11, sphere.d * 0.15),
              fontWeight: 500,
              color: "var(--fg-2)",
              whiteSpace: "nowrap",
              opacity: sphere.alpha,
              textShadow: `0 1px 3px ${dark ? "#000" : "rgba(255,255,255,.9)"}`,
              pointerEvents: "none",
            }}
          >
            {sphere.label}
          </span>
        ))}

      {/* Two scrims keep the copy legible over whatever the stage is doing. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, var(--bg) 6%, color-mix(in oklab, var(--bg) 88%, transparent) 30%, transparent 62%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "22%",
          background: "linear-gradient(180deg, transparent, color-mix(in oklab, var(--bg) 80%, transparent) 90%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
