/**
 * The footer, on the landing page only.
 *
 * Three kinds of destination: a route inside the app, an address outside it,
 * and a link that does not exist yet. The third is rendered as plain text with
 * a "coming soon" suffix and no href, because a link that does nothing when
 * clicked is worse than one that admits it is not ready.
 *
 * Only the label is shown, never the URL. A footer is a place to go, not a
 * place to read addresses out of — and a bare link is what a reader hovers to
 * see where it leads.
 */

import { Link } from "react-router-dom";

import { useAppConfig } from "../api/queries";
import { useCopy } from "../i18n/useCopy";

interface Item {
  label: string;
  /** A route inside the app. */
  to?: string;
  /** An address outside it: opened in its own tab, or a mailto. */
  href?: string;
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
      {items.map((item) => {
        if (item.to) {
          return (
            <Link key={item.label} to={item.to} style={{ fontSize: 13, color: "var(--fg-2)" }}>
              {item.label}
            </Link>
          );
        }
        if (item.href) {
          const external = !item.href.startsWith("mailto:");
          return (
            <a
              key={item.label}
              href={item.href}
              // `noopener` is the one that matters: without it the opened page
              // gets a handle on this one through `window.opener`.
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : null)}
              style={{ fontSize: 13, color: "var(--fg-2)" }}
            >
              {item.label}
            </a>
          );
        }
        return (
          <span key={item.label} style={{ fontSize: 13, color: "var(--fg-3)" }}>
            {item.label} · {t.comingSoon}
          </span>
        );
      })}
    </div>
  );
}

export function Footer() {
  const t = useCopy();
  // From the settings, so changing them there changes what is printed here
  // rather than in two places that can disagree. An address left blank falls
  // back to "coming soon" on its own, because `href` stays undefined.
  const contact = useAppConfig().data?.contact;
  const link = (value: string | undefined) => (value ? value : undefined);
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
              { label: t.linkRepo, href: link(contact?.repository) },
              { label: t.linkApi, href: link(contact?.api_docs) },
              { label: t.linkConfig, to: "/run" },
              { label: t.linkExplore, to: "/explore" },
              { label: t.linkCompare, to: "/compare" },
              { label: t.envelopeCta, to: "/envelope" },
            ]}
          />
          <Column
            title={t.colContact}
            items={[
              { label: t.linkEmail, href: contact?.email ? `mailto:${contact.email}` : undefined },
              { label: t.linkGithub, href: link(contact?.github) },
              { label: t.linkLinkedin, href: link(contact?.linkedin) },
            ]}
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
