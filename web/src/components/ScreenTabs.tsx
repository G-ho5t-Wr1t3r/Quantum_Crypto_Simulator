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

import { Link, useLocation } from "react-router-dom";

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
