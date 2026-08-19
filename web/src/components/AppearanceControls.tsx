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
