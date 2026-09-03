/**
 * The four tool screens, as one control.
 *
 * They were a row of "next page" links pointing at each other, which made the
 * set look like a sequence with an order to follow. It is not one: a run, a
 * sweep, a comparison and an envelope are four ways of asking about the same
 * simulator, and any of them can be the one you want. A tab bar says that, and
 * says which one you are on — which the arrows never did.
 *
 * The labels stay in English in both languages. They are the names of the
 * screens, and a name that changes when the interface language does is a name
 * two people cannot use to refer to the same thing.
 */

import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAppearance } from "../app/appearance";
import { useCopy } from "../i18n/useCopy";
import { Settings } from "./Settings";

const TABS = [
  { to: "/run", label: "Run" },
  { to: "/explore", label: "Sweep" },
  { to: "/compare", label: "Compare" },
  { to: "/envelope", label: "Envelope" },
];

export function ScreenTabs() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Screens"
      style={{
        display: "flex",
        gap: 3,
        padding: 3,
        background: "var(--seg)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        flex: "none",
      }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.to;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            style={{
              padding: "7px 14px",
              border: `1px solid ${active ? "var(--line)" : "transparent"}`,
              borderRadius: 8,
              background: active ? "var(--panel-3)" : "transparent",
              color: active ? "var(--fg)" : "var(--fg-2)",
              fontSize: 12.5,
              fontWeight: active ? 590 : 450,
              letterSpacing: "-.01em",
              whiteSpace: "nowrap",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,.35), inset 0 1px 0 var(--hi)" : "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}


/**
 * Light or dark, in one press.
 *
 * A sun and a moon rather than three words: the theme is the one setting a
 * reader changes on impulse, and a segmented control with an Auto option asked
 * them to think about it. Auto is still what a fresh visit gets — the toggle
 * only appears to have an opinion once someone expresses one.
 */
export function ThemeToggle(
  { size = 36, round = false, bare = false }:
  { size?: number; round?: boolean; bare?: boolean } = {},
) {
  const { theme, setChoice } = useAppearance();
  const t = useCopy();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setChoice(next)}
      aria-label={t.themeToggle}
      title={t.themeToggle}
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: bare ? "1px solid transparent" : "1px solid var(--line)",
        borderRadius: round ? "50%" : 10,
        background: bare ? "none" : "var(--panel-2)",
        color: bare ? "var(--fg-3)" : "var(--fg-2)",
        fontSize: Math.round(size * 0.42),
        lineHeight: 1,
        cursor: "pointer",
        flex: "none",
        boxShadow: bare ? "none" : "inset 0 1px 0 var(--hi)",
      }}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

/** The gear, and the panel it opens. */
export function SettingsButton() {
  const t = useCopy();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.settings}
        title={t.settings}
        style={{
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--line)",
          borderRadius: 10,
          background: "var(--panel-2)",
          color: "var(--fg-2)",
          fontSize: 15,
          lineHeight: 1,
          cursor: "pointer",
          flex: "none",
          boxShadow: "inset 0 1px 0 var(--hi)",
        }}
      >
        ⚙
      </button>
      {open && <Settings onClose={() => setOpen(false)} />}
    </>
  );
}

/** Tabs, theme and settings: the same bar on every tool screen. */
export function TopBarControls() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
      <ScreenTabs />
      <ThemeToggle />
      <SettingsButton />
    </div>
  );
}
