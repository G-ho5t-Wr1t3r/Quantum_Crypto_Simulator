/**
 * A panel over the page, for looking at something in full.
 *
 * It closes three ways — the button, a click outside, Escape — because a reader
 * who wants out should not have to find the one control that does it. The exit
 * is animated rather than instant: a panel that vanishes reads as a glitch,
 * where one that shrinks back reads as having been dismissed.
 *
 * The close is deferred by the length of that animation, which is the only
 * reason this holds state at all.
 *
 * RENDERED INTO `document.body`, and this is not a detail. A `position: fixed`
 * element is only positioned against the viewport while no ancestor has made
 * itself a containing block — and `backdrop-filter` does exactly that, as do
 * `transform` and `filter`. Three of the four screens blur their sticky header,
 * so a panel opened from the button that lives there was being laid out inside
 * a fifty-pixel-tall strip and clipped out of sight. Rendering outside the tree
 * puts it beyond the reach of whatever the page does to itself.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import { useReducedMotion } from "../app/appearance";

const EXIT_MS = 180;

export function Modal({
  title,
  onClose,
  closeLabel,
  actions,
  elevation = 40,
  width = "min(1100px, 100%)",
  children,
}: {
  title: string;
  onClose: () => void;
  closeLabel: string;
  /** What goes beside the close button: the panel's own primary action. */
  actions?: ReactNode;
  /** Raised when one panel opens over another. */
  elevation?: number;
  /**
   * How wide it opens.
   *
   * A panel sized for a table of sweep points is far too wide for a question
   * with two buttons: a line of text stretched across a thousand pixels is one
   * the eye has to track back across, and the two buttons end up in different
   * postcodes.
   */
  width?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(() => {
    if (reduced) {
      onClose();
      return;
    }
    setLeaving(true);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose, reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: elevation,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: "color-mix(in oklab, var(--bg) 72%, transparent)",
        backdropFilter: "blur(4px)",
        animation: reduced ? "none" : `${leaving ? "qfadeOut" : "qfade"} ${EXIT_MS}ms ease both`,
      }}
    >
      <div
        // Clicks inside are not clicks outside.
        onClick={(event) => event.stopPropagation()}
        style={{
          display: "flex",
          flexDirection: "column",
          width,
          maxHeight: "100%",
          border: "1px solid var(--line)",
          borderRadius: 18,
          background: "var(--panel)",
          boxShadow: "0 50px 100px -50px #000, inset 0 1px 0 var(--hi)",
          overflow: "hidden",
          animation: reduced
            ? "none"
            : `${leaving ? "qpopOut" : "qpop"} ${leaving ? EXIT_MS : 260}ms cubic-bezier(.32,.72,0,1) both`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span className="kicker">{title}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {actions}
            <button
            type="button"
            onClick={dismiss}
            aria-label={closeLabel}
            autoFocus
            style={{
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--line)",
              borderRadius: 9,
              background: "var(--panel-2)",
              color: "var(--fg-2)",
              fontSize: 14,
              lineHeight: 1,
              cursor: "pointer",
              boxShadow: "inset 0 1px 0 var(--hi)",
              transition: "transform .25s cubic-bezier(.32,.72,0,1), color .2s ease",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.transform = "rotate(90deg)";
              event.currentTarget.style.color = "var(--fg)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.transform = "none";
              event.currentTarget.style.color = "var(--fg-2)";
            }}
          >
              ✕
            </button>
          </div>
        </div>

        <div style={{ overflow: "auto", padding: "4px 20px 20px" }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
