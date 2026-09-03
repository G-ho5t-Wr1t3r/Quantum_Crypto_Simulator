/**
 * The two segmented switches that appear on every screen: language and theme.
 *
 * Theme has three positions and Auto is the first, because it is the default.
 */

import { useAppearance } from "../app/appearance";
import { useCopy } from "../i18n/useCopy";
import { Segmented } from "./controls";
import type { Lang, ThemeChoice } from "../app/appearance";

export function LangSwitch() {
  const { lang, setLang } = useAppearance();
  return (
    <Segmented<Lang>
      options={[
        { id: "it", label: "IT" },
        { id: "en", label: "EN" },
      ]}
      value={lang}
      onChange={setLang}
    />
  );
}

export function ThemeSwitch() {
  const { choice, setChoice } = useAppearance();
  const t = useCopy();
  return (
    <Segmented<ThemeChoice>
      options={[
        { id: null, label: t.auto, title: t.followSystem },
        { id: "dark", label: t.dark },
        { id: "light", label: t.light },
      ]}
      value={choice}
      onChange={setChoice}
    />
  );
}

/**
 * Lingua come coppia di voci testuali, per la barra della landing.
 *
 * Lì il Segmented sarebbe fuori registro: accanto al selettore del tema
 * produce due riquadri affiancati dentro una pill, e la barra finisce per
 * sembrare un pannello di controllo invece dell'intestazione di una pagina.
 */
export function LangInline() {
  const { lang, setLang } = useAppearance();
  const voci: Lang[] = ["it", "en"];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {voci.map((id, i) => (
        <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          {i > 0 && <span aria-hidden style={{ width: 1, height: 11, background: "var(--line)" }} />}
          <button
            type="button"
            aria-pressed={lang === id}
            onClick={() => setLang(id)}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              fontSize: 12,
              fontWeight: lang === id ? 640 : 500,
              letterSpacing: ".02em",
              color: lang === id ? "var(--fg)" : "var(--fg-3)",
              cursor: "pointer",
            }}
          >
            {id.toUpperCase()}
          </button>
        </span>
      ))}
    </span>
  );
}
