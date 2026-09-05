/**
 * Sequenza per Comparison (/compare).
 *
 * Regola la lunghezza di fibra e la frazione intercettata, lancia le due run
 * reali in parallelo (rumore contro attacco) e scorre fino ai pannelli con i
 * risultati — la schermata, a differenza delle altre, non lo fa da sola.
 */

import { COPY } from "../../i18n/copy";
import { clickElement, dragRange, mountCursor, query, wait, waitForRunCycle } from "../engine";

const t = COPY.it;

export async function run(root: HTMLElement): Promise<void> {
  const cursor = mountCursor(root);
  await wait(700);

  const fibre = query<HTMLInputElement>('[data-testid="fibre-length"]');
  await dragRange(cursor, fibre, 11, { duration: 900 });
  await wait(300);

  const fraction = query<HTMLInputElement>('[data-testid="attack-fraction"]');
  await dragRange(cursor, fraction, 0.55, { duration: 900 });
  await wait(300);

  await clickElement(cursor, query('[data-testid="seed-randomize"]'));
  await wait(400);

  const runButton = query('[data-testid="run-button"]');
  await clickElement(cursor, runButton, { settle: 150 });
  await waitForRunCycle(runButton, t.stop);
  await wait(500);

  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  await wait(1200);

  await wait(2000);
}
