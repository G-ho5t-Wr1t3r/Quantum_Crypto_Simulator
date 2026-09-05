/**
 * Le quattro schermate reali che l'harness puo' mandare in loop.
 *
 * Un solo elenco, condiviso tra il pannello di controllo (fuori dall'iframe) e
 * il documento montato dentro l'iframe, cosi' i due non possono disallinearsi.
 */

export const DEMO_SCREENS = ["configuration", "exploration", "comparison", "envelope"] as const;

export type DemoScreen = (typeof DEMO_SCREENS)[number];

export function isDemoScreen(value: string | null): value is DemoScreen {
  return value !== null && (DEMO_SCREENS as readonly string[]).includes(value);
}

export const SCREEN_TITLES: Record<DemoScreen, string> = {
  configuration: "Configuration · /run",
  exploration: "Exploration · /explore",
  comparison: "Comparison · /compare",
  envelope: "Envelope · /envelope",
};
