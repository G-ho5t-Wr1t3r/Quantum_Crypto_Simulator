/**
 * Sequenza per Exploration (/explore).
 *
 * Mostra il cambio d'asse, restringe il range e i punti per uno sweep veloce,
 * lo lancia sul motore reale, poi apre e richiude la tabella completa.
 */

import { COPY } from "../../i18n/copy";
import { clickElement, dragRange, mountCursor, query, wait, waitForRunCycle } from "../engine";

const t = COPY.it;

export async function run(root: HTMLElement): Promise<void> {
  const cursor = mountCursor(root);
  await wait(700);

  await clickElement(cursor, query('[data-testid="axis-attack_fraction"]'));
  await wait(500);
  await clickElement(cursor, query('[data-testid="axis-length_km"]'));
  await wait(300);

  const rangeMax = query<HTMLInputElement>('[data-testid="range-max"]');
  await dragRange(cursor, rangeMax, 12, { duration: 800 });
  await wait(300);

  // Meno punti: lo sweep resta reale ma dura una manciata di secondi.
  const points = query<HTMLInputElement>('[data-testid="sweep-points"]');
  await dragRange(cursor, points, 9, { duration: 800 });
  await wait(300);

  await clickElement(cursor, query('[data-testid="seed-randomize"]'));
  await wait(400);

  const runButton = query('[data-testid="run-button"]');
  await clickElement(cursor, runButton, { settle: 150 });
  await waitForRunCycle(runButton, t.stop);
  await wait(1000);

  await clickElement(cursor, query('[data-testid="expand-table"]'), { duration: 600 });
  await wait(1800);
  await clickElement(cursor, query(`[aria-label="${t.close}"]`), { duration: 500 });

  await wait(1800);
}
