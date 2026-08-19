/**
 * Placeholders shaped like the thing that is coming.
 *
 * The results area is the largest surface on the screen, and leaving it empty
 * until a run finishes made the page look broken before it looked idle. A
 * skeleton fixes two things at once: the space reads as *reserved* rather than
 * missing, and the layout is already correct when the real content lands, so
 * nothing jumps.
 *
 * `active` distinguishes waiting from resting. A run in flight shimmers; an
 * interface nobody has asked anything of yet holds still, because movement
 * would be promising something that is not happening.
 */

import type { CSSProperties, ReactNode } from "react";

export function Skeleton({
  width = "100%",
  height = 12,
  radius = 6,
  active = true,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  active?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={active ? "skeleton" : "skeleton skeleton--still"}
      style={{ display: "block", width, height, borderRadius: radius, ...style }}
    />
  );
}

/** The frame every result panel shares: a bordered surface with its kicker. */
function Frame({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--panel)",
        boxShadow: "inset 0 1px 0 var(--hi)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The results area before there is a result.
 *
 * It mirrors the real layout — a row of readouts, the chart, the per-position
 * trace — so that the transition into live data is a fill rather than a
 * rebuild.
 */
export function ResultsSkeleton({
  active,
  title,
  hint,
  cards = 4,
}: {
  active: boolean;
  title: string;
  hint: string;
  /** How many readouts this protocol will show, so the row does not reflow. */
  cards?: number;
}) {
  return (
    <section
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--bg-2)",
        padding: "18px 28px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        flex: "1 1 auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minHeight: 34 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 14px",
            borderRadius: 20,
            border: "1px solid var(--line)",
            background: "var(--panel-2)",
            boxShadow: "inset 0 1px 0 var(--hi)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: active ? "var(--blue)" : "var(--line-2)",
              boxShadow: active ? "0 0 8px -1px var(--blue)" : "none",
              animation: active ? "qbreath 1.6s ease-in-out infinite" : "none",
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".04em", color: "var(--fg-2)" }}>
            {title}
          </span>
        </span>
        <span style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{hint}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(186px, 1fr))", gap: 10 }}>
        {Array.from({ length: cards }, (_, index) => (
          <Frame key={index} style={{ gap: 9, padding: "14px 15px" }}>
            <Skeleton width="52%" height={9} active={active} />
            <Skeleton width="70%" height={22} radius={7} active={active} />
            <Skeleton width="40%" height={9} active={active} />
          </Frame>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <Skeleton width={210} height={10} active={active} />
          <Frame style={{ gap: 16, padding: "16px 18px 14px" }}>
            {[0, 1, 2].map((index) => (
              <div key={index} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <Skeleton width={`${58 - index * 8}%`} height={9} active={active} />
                  <Skeleton width={52} height={9} active={active} />
                </div>
                <Skeleton height={13} radius={4} active={active} />
              </div>
            ))}
            <Skeleton height={1} radius={0} active={false} style={{ background: "var(--line-2)" }} />
            <Skeleton width="46%" height={9} active={active} style={{ alignSelf: "center" }} />
          </Frame>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <Skeleton width={180} height={10} active={active} />
          <Frame style={{ gap: 9 }}>
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                style={{ display: "grid", gridTemplateColumns: "78px minmax(0,1fr)", alignItems: "center", gap: 10 }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <Skeleton width={46} height={9} active={active} />
                  <Skeleton width={62} height={7} active={active} />
                </div>
                <div style={{ display: "flex", gap: 2, minWidth: 0 }}>
                  {Array.from({ length: 26 }, (_, cell) => (
                    <Skeleton key={cell} width={0} height={30} radius={5} active={active} style={{ flex: "1 1 0" }} />
                  ))}
                </div>
              </div>
            ))}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "78px minmax(0,1fr)",
                alignItems: "center",
                gap: 10,
                paddingTop: 2,
                borderTop: "1px solid var(--line)",
              }}
            >
              <Skeleton width={58} height={8} active={active} />
              <div style={{ display: "flex", gap: 2, minWidth: 0, height: 16, alignItems: "center" }}>
                {Array.from({ length: 26 }, (_, cell) => (
                  <Skeleton key={cell} width={0} height={8} radius={3} active={active} style={{ flex: "1 1 0" }} />
                ))}
              </div>
            </div>
          </Frame>
        </div>
      </div>
    </section>
  );
}


/**
 * The sweep figure before there is a curve.
 *
 * Same frame, same height, same axis furniture: pressing Run fills the plot
 * that is already on screen rather than replacing an empty box with a different
 * one.
 */
export function ChartSkeleton({ active, height = 400 }: { active: boolean; height?: number }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--plot)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "18px 20px 46px 62px",
      }}
    >
      {[0.18, 0.34, 0.5, 0.66, 0.82].map((at) => (
        <div key={at} style={{ height: 1, background: "var(--line)" }} />
      ))}
      <div
        style={{
          position: "absolute",
          left: 62,
          right: 20,
          top: "42%",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "center",
        }}
      >
        <Skeleton width="62%" height={10} active={active} />
        <Skeleton width="38%" height={10} active={active} />
      </div>
    </div>
  );
}

/** A block of readouts, three across, before any of them has a value. */
export function ReadoutsSkeleton({ active, count = 3 }: { active: boolean; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "16px 18px",
            border: "1px solid var(--line)",
            borderRadius: 14,
            background: "var(--panel)",
            boxShadow: "inset 0 1px 0 var(--hi)",
          }}
        >
          <Skeleton width="54%" height={9} active={active} />
          <Skeleton width="46%" height={22} radius={7} active={active} />
          <Skeleton width="72%" height={9} active={active} />
        </div>
      ))}
    </>
  );
}

/**
 * One side of the comparison while its run is still going.
 *
 * Each side is a four thousand qubit simulation, so this is on screen for a few
 * seconds every time — long enough that empty bars and a dash read as a fault.
 */
export function SideSkeleton({ active, bars }: { active: boolean; bars: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {Array.from({ length: bars }, (_, index) => (
        <div key={index} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <Skeleton width={`${56 - index * 8}%`} height={9} active={active} />
            <Skeleton width={54} height={9} active={active} />
          </div>
          <Skeleton height={13} radius={4} active={active} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 1, height: 24, alignItems: "center" }}>
        {Array.from({ length: 36 }, (_, cell) => (
          <Skeleton key={cell} width={0} height={10} radius={2} active={active} style={{ flex: "1 1 0" }} />
        ))}
      </div>
    </div>
  );
}
