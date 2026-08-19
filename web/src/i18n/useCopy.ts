import { useAppearance } from "../app/appearance";
import { COPY, type Copy } from "./copy";

/** The dictionary for the language currently selected. */
export function useCopy(): Copy {
  const { lang } = useAppearance();
  return COPY[lang];
}

/** The locale to format numbers in, so thousands separators follow the copy. */
export function useLocale(): string {
  const { lang } = useAppearance();
  return lang === "it" ? "it-IT" : "en-US";
}
