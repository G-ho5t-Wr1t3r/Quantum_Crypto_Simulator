/**
 * Sequenza per Configuration (/run).
 *
 * Passa da canale ideale a rumore di ampiezza, attiva l'intercept-resend,
 * apre l'ispettore su Eve, digita un seed e lancia una run vera sul motore.
 */

import { COPY } from "../../i18n/copy";
import {
  clickElement,
  dragRange,
  mountCursor,
  query,
  queryOptional,
  radioOption,
  typeInto,
  wait,
  waitForRunCycle,
} from "../engine";

const t = COPY.it;
const DEMO_SEED = "48120936";

export async function run(root: HTMLElement): Promise<void> {
  const cursor = mountCursor(root);
  await wait(700);

  const channelSeg = query('[data-testid="channel-kind"]');
  await clickElement(cursor, radioOption(channelSeg, t.ideal));
  await wait(350);
  await clickElement(cursor, radioOption(channelSeg, t.damping));
  const gamma = queryOptional<HTMLInputElement>('[data-testid="channel-gamma"]');
  if (gamma) await dragRange(cursor, gamma, 0.16, { duration: 900 });
  await wait(300);

  const attackSeg = query('[data-testid="attack-kind"]');
  await clickElement(cursor, radioOption(attackSeg, t.noAttack));
  await wait(350);
  await clickElement(cursor, radioOption(attackSeg, t.interceptResend));
  const fraction = queryOptional<HTMLInputElement>('[data-testid="attack-fraction"]');
  if (fraction) await dragRange(cursor, fraction, 0.35, { duration: 900 });
  await wait(400);

  // Il nodo di Eve compare solo quando l'attacco e' attivo: e' il momento
  // giusto per farlo vedere, prima che la corsa ai risultati sposti lo sguardo.
  const eveNode = queryOptional('[data-testid="node-eve"]');
  if (eveNode) {
    await clickElement(cursor, eveNode, { duration: 700 });
    await wait(1500);
    const closeBtn = queryOptional('[aria-label="close"]');
    if (closeBtn) await clickElement(cursor, closeBtn, { duration: 500 });
  }
  await wait(300);

  const seedInput = query<HTMLInputElement>('[data-testid="seed-input"]');
  await typeInto(cursor, seedInput, DEMO_SEED);
  await wait(300);

  const runButton = query('[data-testid="run-button"]');
  await clickElement(cursor, runButton, { settle: 150 });
  await waitForRunCycle(runButton, t.stop);
  // La schermata scorre da sola verso i risultati appena la run finisce.
  await wait(2200);
}
