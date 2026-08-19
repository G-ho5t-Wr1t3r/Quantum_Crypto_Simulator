/**
 * The planet, with real geography.
 *
 * Natural Earth's 110m countries in an orthographic projection, turning
 * continuously. It is vendored through the `world-atlas` package rather than
 * hot-linked from a CDN, and loaded on demand so that the first paint of the
 * page does not wait on a hundred kilobytes of coastline.
 *
 * The hubs are real places with real coordinates, and the links between them are
 * great-circle arcs sampled along the sphere — not straight lines drawn on a
 * flat picture of it. An arc whose endpoints are both over the horizon is not
 * drawn at all, because a link that appears to cross the back of the globe is
 * telling the viewer something false about where it goes.
 *
 * Public domain geometry; the credit in the footer is required and stays.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import type { GeoPermissibleObjects } from "d3-geo";

import { useReducedMotion } from "../../app/appearance";

/** QKD-relevant cities: the places metropolitan and satellite links run between. */
const HUBS: { name: string; c: [number, number] }[] = [
  { name: "Geneva", c: [6.14, 46.2] },
  { name: "Vienna", c: [16.37, 48.21] },
  { name: "Madrid", c: [-3.7, 40.42] },
  { name: "Delft", c: [4.36, 52.01] },
  { name: "Beijing", c: [116.4, 39.9] },
  { name: "Shanghai", c: [121.47, 31.23] },
  { name: "Tokyo", c: [139.69, 35.69] },
  { name: "Singapore", c: [103.82, 1.35] },
  { name: "New York", c: [-74.0, 40.71] },
  { name: "Ottawa", c: [-75.7, 45.42] },
  { name: "São Paulo", c: [-46.63, -23.55] },
  { name: "Los Angeles", c: [-118.24, 34.05] },
  { name: "London", c: [-0.13, 51.51] },
  { name: "Sydney", c: [151.21, -33.87] },
];

const LINKS: [number, number][] = [
  [0, 1], [0, 2], [0, 3], [1, 3], [2, 10], [0, 12], [1, 12],
  [4, 5], [5, 6], [4, 7], [6, 7], [4, 13], [5, 13],
  [8, 9], [8, 0], [8, 11], [11, 2], [9, 12], [10, 7], [1, 4], [8, 6],
];

const SIZE = 620;
const RADIUS = SIZE / 2 - 10;
/** Tilted north so the populated hemisphere faces the viewer. */
const LATITUDE = -14;

export function Globe({ dark, spinBoost }: { dark: boolean; spinBoost: number }) {
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [lambda, setLambda] = useState(0);
  const reduced = useReducedMotion();
  const boost = useRef(spinBoost);
  boost.current = spinBoost;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ feature }, topology] = await Promise.all([
        import("topojson-client"),
        import("world-atlas/countries-110m.json"),
      ]);
      if (cancelled) return;
      const topo = (topology as { default?: unknown }).default ?? topology;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const collection = feature(topo as any, (topo as any).objects.countries);
      setLand(collection as unknown as GeoPermissibleObjects);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A frame loop, not a CSS animation: the rotation feeds a projection, so the
  // paths have to be recomputed rather than transformed. Reduced motion stops it
  // entirely — the globe simply stands still, which is the honest still frame.
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(60, now - last);
      last = now;
      setLambda((current) => (current + dt * 0.0085 * boost.current) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const { projection, path } = useMemo(() => {
    const p = geoOrthographic().scale(RADIUS).translate([SIZE / 2, SIZE / 2]).clipAngle(90);
    p.rotate([lambda, LATITUDE]);
    return { projection: p, path: geoPath(p) };
  }, [lambda]);

  const ocean = dark ? ["#12304e", "#0a1a2e", "#050a14"] : ["#cfe1f5", "#a9c6e4", "#8fb0d2"];
  const landFill = dark ? "#2c5f4c" : "#dce4cd";
  const landStroke = dark ? "#57957a" : "#9aa98a";
  const graticuleStroke = dark ? "rgba(150,200,255,.1)" : "rgba(30,60,100,.12)";
  const rimStroke = dark ? "rgba(140,190,255,.4)" : "rgba(30,60,100,.35)";

  const visible = (coordinates: [number, number]) =>
    geoDistance(coordinates, [-lambda, -LATITUDE]) < Math.PI / 2 - 0.04;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%" style={{ overflow: "visible" }}>
      <defs>
        <radialGradient id="qkd-ocean" cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor={ocean[0]} />
          <stop offset="58%" stopColor={ocean[1]} />
          <stop offset="100%" stopColor={ocean[2]} />
        </radialGradient>
      </defs>

      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="url(#qkd-ocean)" />
      <path d={path(geoGraticule10()) ?? undefined} fill="none" stroke={graticuleStroke} strokeWidth={0.5} />

      {land && <path d={path(land) ?? undefined} fill={landFill} stroke={landStroke} strokeWidth={0.45} />}

      <g fill="none" strokeLinecap="round">
        {LINKS.map(([from, to], index) => {
          const a = HUBS[from]!.c;
          const b = HUBS[to]!.c;
          const bothHidden = !visible(a) && !visible(b);
          if (bothHidden) return null;
          const interpolate = geoInterpolate(a, b);
          const points = Array.from({ length: 26 }, (_, step) => interpolate(step / 25));
          return (
            <path
              key={index}
              d={path({ type: "LineString", coordinates: points }) ?? undefined}
              stroke={index % 3 === 0 ? "#4cc47d" : "#7fb4ff"}
              strokeWidth={1.4}
              opacity={visible(a) && visible(b) ? 0.85 : 0.3}
            />
          );
        })}
      </g>

      <g>
        {HUBS.map((hub) => {
          const point = projection(hub.c);
          if (!point || !visible(hub.c)) return null;
          return (
            <circle key={hub.name} cx={point[0]} cy={point[1]} r={3.1} fill="#ffffff" stroke="#7fb4ff" strokeWidth={1.2} />
          );
        })}
      </g>

      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={rimStroke} strokeWidth={1} />
    </svg>
  );
}
