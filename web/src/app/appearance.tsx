/**
 * Language and theme, shared by every screen.
 *
 * Both are three-state on purpose. The theme's third state is "auto", which is
 * the default: it follows the operating system live rather than being read once
 * at start-up, so a machine that switches to dark at sunset takes the interface
 * with it. Language has no auto — Italian is the default because the thesis is
 * in Italian, and English is a deliberate choice.
 *
 * The chosen values are persisted, so a reload does not throw away a decision
 * the reader already made.
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "it" | "en";
export type Theme = "dark" | "light";
/** null means "follow the system". */
export type ThemeChoice = Theme | null;

interface Appearance {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** What the user picked; null while following the system. */
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  /** What is actually painted, once the system has had its say. */
  theme: Theme;
}

const AppearanceContext = createContext<Appearance | null>(null);

const LANG_KEY = "qkd.lang";
const THEME_KEY = "qkd.theme";

/**
 * Storage that cannot bring the page down.
 *
 * Reading `localStorage` throws outright in a few real situations — a private
 * window with storage blocked, an embedded context, a test environment that
 * never implemented it. A remembered preference is worth having and is not
 * worth a blank page, so every access is guarded and failure just means the
 * defaults.
 */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the choice still applies for this session.
  }
}

function storedLang(): Lang {
  return readStored(LANG_KEY) === "en" ? "en" : "it";
}

function storedChoice(): ThemeChoice {
  const value = readStored(THEME_KEY);
  return value === "dark" || value === "light" ? value : null;
}

export function AppearanceProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  /** Overrides the stored preference for this mount, without touching storage. */
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? storedLang());
  const [choice, setChoiceState] = useState<ThemeChoice>(storedChoice);
  const [system, setSystem] = useState<Theme>("dark");

  // Attached as a listener rather than read once: "auto" that stops following
  // after the first paint is not auto.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const read = (matches: boolean) => setSystem(matches ? "light" : "dark");
    read(query.matches);
    const onChange = (event: MediaQueryListEvent) => read(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = choice ?? system;

  // On the root element, so a portal or a full-screen overlay inherits it too.
  useEffect(() => {
    document.documentElement.setAttribute("data-qkd", theme);
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const value = useMemo<Appearance>(
    () => ({
      lang,
      setLang: (next) => {
        writeStored(LANG_KEY, next);
        setLangState(next);
      },
      choice,
      setChoice: (next) => {
        writeStored(THEME_KEY, next);
        setChoiceState(next);
      },
      theme,
    }),
    [lang, choice, theme],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider");
  return value;
}

/**
 * True when the reader asked their system for less movement.
 *
 * Read as state rather than left to CSS because some of the motion here is not
 * an animation the browser can slow down: the globe turns because a frame loop
 * advances it, and the only way to honour the preference is not to start it.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
