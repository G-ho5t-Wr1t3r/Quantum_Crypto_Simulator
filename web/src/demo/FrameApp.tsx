/**
 * Il documento montato dentro l'iframe registrabile.
 *
 * Monta una sola schermata reale, fuori da qualunque `<Routes>` dell'app: solo
 * i provider di cui le schermate hanno davvero bisogno (query client, tema,
 * contesto di router per `useSearchParams`/`ScreenTabs`). Alla fine di ogni
 * sequenza ricarica il documento, cosi' la schermata riparte da zero — stato
 * pulito, seed nuovo dov'e' previsto — ed e' anche cosi' che "Riparti da capo"
 * funziona dal pannello fuori dal riquadro.
 */

import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { AppearanceProvider } from "../app/appearance";
import Configuration from "../screens/configuration/Configuration";
import Exploration from "../screens/exploration/Exploration";
import Comparison from "../screens/comparison/Comparison";
import Envelope from "../screens/envelope/Envelope";
import "../index.css";

import type { DemoScreen } from "./screens";
import { run as runConfiguration } from "./scripts/configuration";
import { run as runExploration } from "./scripts/exploration";
import { run as runComparison } from "./scripts/comparison";
import { run as runEnvelope } from "./scripts/envelope";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const SCRIPTS: Record<DemoScreen, (root: HTMLElement) => Promise<void>> = {
  configuration: runConfiguration,
  exploration: runExploration,
  comparison: runComparison,
  envelope: runEnvelope,
};

const SCREENS: Record<DemoScreen, ComponentType> = {
  configuration: Configuration,
  exploration: Exploration,
  comparison: Comparison,
  envelope: Envelope,
};

/** Pausa sul risultato finale prima che il loop ricarichi tutto da capo. */
const LOOP_PAUSE_MS = 1600;

export function FrameApp({ screen }: { screen: DemoScreen }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const Screen = SCREENS[screen];

  useEffect(() => {
    let cancelled = false;
    const stage = stageRef.current;
    if (!stage) return;

    void (async () => {
      // Lascia che il primo layout si assesti prima di muovere il cursore.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      if (cancelled) return;

      try {
        await SCRIPTS[screen](stage);
      } catch (error) {
        // Un elemento mancante (backend spento, run rifiutata) non deve bloccare
        // il loop: resta in console e la sequenza riparte comunque da capo.
        console.error("[demo]", error);
      }
      if (cancelled) return;

      window.setTimeout(() => {
        if (!cancelled) window.location.reload();
      }, LOOP_PAUSE_MS);
    })();

    return () => {
      cancelled = true;
    };
  }, [screen]);

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <MemoryRouter initialEntries={[screen === "configuration" ? "/run" : "/"]}>
          <div ref={stageRef} style={{ position: "relative" }}>
            <Screen />
          </div>
        </MemoryRouter>
      </AppearanceProvider>
    </QueryClientProvider>
  );
}
