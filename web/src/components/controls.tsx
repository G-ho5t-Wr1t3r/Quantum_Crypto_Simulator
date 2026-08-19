/**
 * The small shared controls: segmented switches, sliders, chips.
 *
 * Styles are inline and read every colour through the token custom properties.
 * That is deliberate: the design is token-driven, and a component that resolves
 * its own colour at build time would stop following the theme.
 */

import type { CSSProperties, ReactNode } from "react";

export interface Option<T> {
  id: T;
  label: string;
  title?: string;
}

function segmentStyle(active: boolean, wide: boolean): CSSProperties {
  return {
    flex: wide ? 1 : "none",
    padding: wide ? "7px 10px" : "6px 11px",
    border: `1px solid ${active ? "var(--line)" : "transparent"}`,
    borderRadius: 8,
    background: active ? "var(--panel-3)" : "transparent",
    color: active ? "var(--fg)" : "var(--fg-2)",
    fontFamily: wide ? "inherit" : "ui-monospace, 'SF Mono', monospace",
    fontSize: wide ? 12 : 11,
    fontWeight: active ? 590 : 450,
    letterSpacing: "-.01em",
    cursor: "pointer",
    boxShadow: active ? "0 1px 2px rgba(0,0,0,.35), inset 0 1px 0 var(--hi)" : "none",
    transition: "background .16s ease, color .16s ease",
  };
}

/** A row of mutually exclusive choices. `wide` fills the available width. */
export function Segmented<T extends string | null>({
  options,
  value,
  onChange,
  wide = false,
  style,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  wide?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: "flex",
        gap: 3,
        padding: 3,
        background: "var(--seg)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        ...style,
      }}
    >
      {options.map((option) => (
        <button
          key={String(option.id)}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          title={option.title}
          onClick={() => onChange(option.id)}
          style={segmentStyle(option.id === value, wide)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A labelled slider with its value shown and a sentence explaining what it does.
 *
 * The hint is not decoration. Every one of these parameters means something
 * physical, and a number the reader cannot interpret is a number they cannot
 * defend.
 */
export function Slider({
  label,
  display,
  hint,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  display: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 12.5, color: "var(--fg)" }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
      />
      {hint && <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.45 }}>{hint}</span>}
    </div>
  );
}

/** A rounded tag carrying one parameter or one state. */
export function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        padding: "5px 10px",
        borderRadius: 20,
        border: `1px solid color-mix(in oklab, ${color} 32%, transparent)`,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        color,
        fontSize: 10.5,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** The standard panel: a bordered surface with the house inset highlight. */
export function Panel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 16,
        background: "var(--panel)",
        boxShadow: "inset 0 1px 0 var(--hi)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A mono kicker: the small uppercase label that titles every section. */
export function Kicker({ children }: { children: ReactNode }) {
  return <span className="kicker">{children}</span>;
}

/** The primary action. Disabled while a run is in flight. */
export function RunButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: 13,
        borderRadius: 11,
        border: `1px solid ${busy ? "var(--line)" : "transparent"}`,
        background: busy ? "var(--panel-2)" : "var(--blue)",
        color: busy ? "var(--fg-2)" : "#fff",
        fontSize: 14,
        fontWeight: 590,
        cursor: busy ? "default" : "pointer",
        boxShadow: busy ? "none" : "0 10px 24px -16px #000, inset 0 1px 0 rgba(255,255,255,.22)",
      }}
    >
      {label}
    </button>
  );
}
