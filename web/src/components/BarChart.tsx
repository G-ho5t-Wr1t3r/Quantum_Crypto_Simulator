/**
 * A horizontal bar chart with a decision line on it.
 *
 * Used wherever a measured value has to be read against a bound: the QBER
 * against its threshold, the Bell parameter against 2 + kσ, the two per-basis
 * error rates against a target. The design is the same in all three cases and
 * so is the component.
 *
 * Two things it does on purpose:
 *
 *   - the rule is drawn *through* the bars rather than beside them, so whether
 *     a value clears it is a matter of looking rather than of comparing two
 *     numbers in different places;
 *   - the tick labels clamp at the edges instead of centring, because a label
 *     centred on the last tick is half outside the frame.
 */

import type { CSSProperties } from "react";

export interface Series {
  label: string;
  value: number;
  color: string;
  /** The value written out, already formatted with its unit. */
  text: string;
}

export interface Rule {
  value: number;
  color: string;
  label: string;
}

export interface Zones {
  leftLabel: string;
  rightLabel: string;
  /** True when the region below the rule is the accepting one. */
  leftAccepts: boolean;
}

function zoneChip(color: string, pushRight: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    marginLeft: pushRight ? "auto" : undefined,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 9px",
    borderRadius: 6,
    border: `1px solid color-mix(in oklab, ${color} 34%, transparent)`,
    background: `color-mix(in oklab, ${color} 12%, transparent)`,
    color,
    fontSize: 9.5,
    letterSpacing: ".06em",
    whiteSpace: "nowrap",
  };
}

export function BarChart({
  series,
  max,
  ticks,
  formatTick,
  rule,
  zones,
  axisTitle,
}: {
  series: Series[];
  max: number;
  ticks: number[];
  formatTick: (value: number) => string;
  rule: Rule;
  zones?: Zones;
  axisTitle: string;
}) {
  const pct = (value: number) => Math.min(100, Math.max(0, (value / max) * 100));
  const rulePct = pct(rule.value);
  const acceptColor = "var(--mint)";
  const rejectColor = "var(--red)";

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--panel)",
        padding: "16px 18px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "inset 0 1px 0 var(--hi)",
      }}
    >
      {zones && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="mono" style={zoneChip(zones.leftAccepts ? acceptColor : rejectColor, false)}>
            <span style={{ fontSize: 11 }}>◀</span>
            {zones.leftLabel}
          </div>
          <div className="mono" style={zoneChip(zones.leftAccepts ? rejectColor : acceptColor, true)}>
            {zones.rightLabel}
            <span style={{ fontSize: 11 }}>▶</span>
          </div>
        </div>
      )}

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
        {zones && (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: `${rulePct.toFixed(2)}%`,
                background: zones.leftAccepts ? acceptColor : rejectColor,
                opacity: 0.07,
                borderRadius: "6px 0 0 6px",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${rulePct.toFixed(2)}%`,
                top: 0,
                bottom: 0,
                right: 0,
                background: zones.leftAccepts ? rejectColor : acceptColor,
                opacity: 0.07,
                borderRadius: "0 6px 6px 0",
                pointerEvents: "none",
              }}
            />
          </>
        )}

        {ticks.map((tick) => (
          <div
            key={`grid-${tick}`}
            style={{
              position: "absolute",
              left: `${pct(tick).toFixed(2)}%`,
              top: 0,
              bottom: 0,
              width: 0,
              borderLeft: "1px solid var(--line)",
              pointerEvents: "none",
            }}
          />
        ))}

        {series.map((bar) => (
          <div
            key={bar.label}
            style={{ position: "relative", display: "flex", flexDirection: "column", gap: 5, zIndex: 2 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.3 }}>{bar.label}</span>
              <span
                className="mono"
                style={{ fontSize: 12.5, fontWeight: 600, color: bar.color, whiteSpace: "nowrap" }}
              >
                {bar.text}
              </span>
            </div>
            <div
              style={{
                position: "relative",
                height: 13,
                borderRadius: 4,
                background: "var(--seg)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  // A hairline even at zero, so an empty bar reads as measured
                  // and equal to nothing rather than as missing.
                  width: `${Math.max(0.6, pct(bar.value)).toFixed(2)}%`,
                  borderRadius: 4,
                  background: `linear-gradient(90deg, color-mix(in oklab, ${bar.color} 72%, black), ${bar.color})`,
                  boxShadow: `0 0 10px -4px ${bar.color}`,
                  transition: "width .7s cubic-bezier(.32,.72,0,1)",
                }}
              />
            </div>
          </div>
        ))}

        <div
          style={{
            position: "absolute",
            left: `${rulePct.toFixed(2)}%`,
            top: -2,
            bottom: -4,
            width: 0,
            borderLeft: `1.5px dashed ${rule.color}`,
            zIndex: 3,
            pointerEvents: "none",
          }}
        />
      </div>

      <div style={{ position: "relative", height: 1, background: "var(--line-2)", marginTop: 2 }} />

      <div style={{ position: "relative", height: 26 }}>
        {ticks.map((tick) => {
          const x = pct(tick);
          const edge: CSSProperties =
            x < 4
              ? { left: 0 }
              : x > 96
                ? { right: 0 }
                : { left: `${x.toFixed(2)}%`, transform: "translateX(-50%)" };
          return (
            <span
              key={`tick-${tick}`}
              className="mono"
              style={{ position: "absolute", top: 0, fontSize: 10, color: "var(--fg-3)", whiteSpace: "nowrap", ...edge }}
            >
              {formatTick(tick)}
            </span>
          );
        })}
        <span
          className="mono"
          style={{
            position: "absolute",
            top: 13,
            left: `${rulePct.toFixed(2)}%`,
            transform: `translateX(${rulePct > 72 ? "-100%" : rulePct < 12 ? "0" : "-50%"})`,
            fontSize: 10.5,
            fontWeight: 500,
            color: rule.color,
            whiteSpace: "nowrap",
          }}
        >
          ▲ {rule.label}
        </span>
      </div>

      <span style={{ fontSize: 10.5, color: "var(--fg-3)", textAlign: "center" }}>{axisTitle}</span>
    </div>
  );
}
