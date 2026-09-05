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
  label,
  disabled = false,
  style,
  testId,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  wide?: boolean;
  /**
   * Locked while a run is in flight.
   *
   * A control that still moves during a simulation is a control that lies: the
   * run in progress was launched with the old value, and the reader is left
   * looking at settings that do not describe what is being computed.
   */
  disabled?: boolean;
  /**
   * What this group of choices is for.
   *
   * Worth setting wherever two groups on the same screen share option names —
   * the interface theme and the figure's palette are both Light/Dark, and
   * without a group name neither the reader using a screen reader nor a test
   * can tell which one is which.
   */
  label?: string;
  style?: CSSProperties;
  /** A stable hook for automated interaction (tests, scripted demos). */
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
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
          disabled={disabled}
          onClick={() => onChange(option.id)}
          style={{
            ...segmentStyle(option.id === value, wide),
            cursor: disabled ? "default" : "pointer",
            opacity: disabled && option.id !== value ? 0.45 : 1,
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One step of the slider, for when dragging cannot land on the value wanted. */
function Nudge({
  direction,
  onClick,
  disabled,
  label,
}: {
  direction: "down" | "up";
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 20,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "var(--panel-2)",
        color: disabled ? "var(--fg-3)" : "var(--fg-2)",
        fontSize: 11,
        lineHeight: 1,
        cursor: disabled ? "default" : "pointer",
        boxShadow: "inset 0 1px 0 var(--hi)",
      }}
    >
      {direction === "down" ? "−" : "+"}
    </button>
  );
}

/**
 * A labelled slider with its value shown and a sentence explaining what it does.
 *
 * The hint is not decoration. Every one of these parameters means something
 * physical, and a number the reader cannot interpret is a number they cannot
 * defend.
 *
 * The two nudge buttons exist because a slider is good at "roughly here" and
 * bad at "exactly this". Wanting 51 % rather than 50, or 0.81 rather than 0.80,
 * is not an unusual thing to want — a run is meant to be reproducible, and a
 * value you cannot land on is a run you cannot repeat.
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
  disabled = false,
  testId,
}: {
  label: string;
  display: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /** Locked while a run is in flight; see `Segmented`. */
  disabled?: boolean;
  /** A stable hook for automated interaction (tests, scripted demos). */
  testId?: string;
}) {
  // Stepping in floating point drifts: 0.1 + 0.005 is not 0.105. Rounding to
  // the grid the step defines keeps the value on it.
  const nudge = (by: number) => {
    const next = Math.min(max, Math.max(min, value + by * step));
    const decimals = (String(step).split(".")[1] ?? "").length;
    onChange(Number(next.toFixed(decimals)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: disabled ? "var(--fg-3)" : "var(--fg-2)" }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Nudge direction="down" onClick={() => nudge(-1)} disabled={disabled || value <= min} label={`${label} −`} />
          <span className="mono" style={{ fontSize: 12.5, color: "var(--fg)", whiteSpace: "nowrap" }}>
            {display}
          </span>
          <Nudge direction="up" onClick={() => nudge(1)} disabled={disabled || value >= max} label={`${label} +`} />
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        data-testid={testId}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        style={{ opacity: disabled ? 0.5 : 1 }}
      />
      {/* `pre-line`, so a hint that separates two thoughts onto two lines keeps
          them there instead of running them together. */}
      {hint && (
        <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.45, whiteSpace: "pre-line" }}>{hint}</span>
      )}
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

/**
 * The primary action, which becomes its own opposite while it runs.
 *
 * One button rather than two, because there is only ever one thing to do with a
 * simulation: start it, or stop the one that is going. A greyed-out Run said
 * "wait" and offered no way out of a sweep that turns out to be forty points
 * long.
 *
 * Red, and not merely a different word: stopping discards work, and the colour
 * is the one this interface already uses for a key that was thrown away.
 */
export function RunButton({
  label,
  stopLabel,
  busy,
  onClick,
  onStop,
}: {
  label: string;
  /** Shown while running. Without `onStop` the button stays disabled instead. */
  stopLabel?: string;
  busy: boolean;
  onClick: () => void;
  onStop?: () => void;
}) {
  const stoppable = busy && !!onStop;
  return (
    <button
      type="button"
      onClick={stoppable ? onStop : onClick}
      disabled={busy && !stoppable}
      data-testid="run-button"
      style={{
        padding: 13,
        borderRadius: 11,
        border: `1px solid ${busy && !stoppable ? "var(--line)" : "transparent"}`,
        background: stoppable ? "var(--red)" : busy ? "var(--panel-2)" : "var(--blue)",
        color: busy && !stoppable ? "var(--fg-2)" : "#fff",
        fontSize: 14,
        fontWeight: 590,
        cursor: busy && !stoppable ? "default" : "pointer",
        boxShadow:
          busy && !stoppable ? "none" : "0 10px 24px -16px #000, inset 0 1px 0 rgba(255,255,255,.22)",
      }}
    >
      {stoppable ? stopLabel : label}
    </button>
  );
}
