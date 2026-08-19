/**
 * A message strip for the states a screen can be in but cannot draw.
 *
 * There is one of these rather than three hand-rolled paragraphs because the
 * cases are the same everywhere — the backend is unreachable, or a run was
 * refused — and a reader should not have to work out that two differently
 * styled red sentences mean the same kind of thing.
 */

import type { ReactNode } from "react";

export type Tone = "error" | "notice";

const TONE: Record<Tone, string> = {
  error: "var(--red)",
  notice: "var(--orange)",
};

export function Banner({ tone, children }: { tone: Tone; children: ReactNode }) {
  const color = TONE[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 12,
        border: `1px solid color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 12%, var(--panel))`,
        color,
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px -1px ${color}`,
          flex: "none",
          marginTop: 5,
        }}
      />
      <span>{children}</span>
    </div>
  );
}
