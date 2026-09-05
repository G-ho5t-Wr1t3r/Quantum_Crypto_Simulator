/**
 * Sequenza per Envelope (/envelope).
 *
 * Restringe la griglia (meno passi in lunghezza e frazione) cosi' l'inviluppo
 * resta un calcolo vero ma finisce in pochi secondi, poi lo lancia.
 */

import { COPY } from "../../i18n/copy";
import { clickElement, dragRange, mountCursor, query, wait, waitForRunCycle } from "../engine";

const t = COPY.it;

export async function run(root: HTMLElement): Promise<void> {
  const cursor = mountCursor(root);
  await wait(700);

  const lengthSteps = query<HTMLInputElement>('[data-testid="length-steps"]');
  await dragRange(cursor, lengthSteps, 5, { duration: 800 });
  await wait(300);

  const fractionSteps = query<HTMLInputElement>('[data-testid="fraction-steps"]');
  await dragRange(cursor, fractionSteps, 5, { duration: 800 });
  await wait(300);

  await clickElement(cursor, query('[data-testid="seed-randomize"]'));
  await wait(400);

  const runButton = query('[data-testid="run-button"]');
  await clickElement(cursor, runButton, { settle: 150 });
  await waitForRunCycle(runButton, t.stop);
  await wait(2400);
}
