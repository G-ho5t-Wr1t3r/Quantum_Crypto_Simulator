/**
 * The shared footer.
 *
 * Links that do not exist yet are rendered as text with a "coming soon" suffix
 * and no href, rather than as a live link to nowhere: a link that does nothing
 * when clicked is worse than one that says it is not ready.
 *
 * The Natural Earth credit is required by the geometry the landing page uses and
 * must stay.
 */

import { Link } from "react-router-dom";

import { useCopy } from "../i18n/useCopy";

interface Item {
  label: string;
  to?: string;
}

function Column({ title, items }: { title: string; items: Item[] }) {
  const t = useCopy();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, minWidth: 150 }}>
      <span
        className="mono"
        style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--fg-2)" }}
      >
        {title}
      </span>
      {items.map((item) =>
        item.to ? (
          <Link key={item.label} to={item.to} style={{ fontSize: 13, color: "var(--fg-2)" }}>
            {item.label}
          </Link>
        ) : (
          <span key={item.label} style={{ fontSize: 13, color: "var(--fg-3)" }}>
            {item.label} · {t.comingSoon}
          </span>
        ),
      )}
    </div>
  );
}

export function Footer() {
  const t = useCopy();
  return (
    <footer
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--bg-2)",
        padding: "52px 26px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 32,
          justifyContent: "space-between",
          alignItems: "flex-start",
          maxWidth: 1500,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--fg)" }}>{t.brand}</span>
          <span style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6 }}>{t.footerBlurb}</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 26 }}>
          <Column
            title={t.colProject}
            items={[
              { label: t.linkRepo },
              { label: t.linkApi },
              { label: t.linkConfig, to: "/run" },
              { label: t.linkExplore, to: "/explore" },
              { label: t.linkCompare, to: "/compare" },
              { label: t.linkHome, to: "/" },
            ]}
          />
          <Column
            title={t.colContact}
            items={[{ label: "Email" }, { label: "GitHub" }, { label: "LinkedIn" }]}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 20,
          borderTop: "1px solid var(--line)",
          maxWidth: 1500,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
          {t.footerNote}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
          {t.footerCredits}
        </span>
      </div>
    </footer>
  );
}
