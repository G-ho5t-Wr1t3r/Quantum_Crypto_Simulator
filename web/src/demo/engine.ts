/**
 * Cursore finto e interazioni DOM per le sequenze di registrazione.
 *
 * Opera sul DOM gia' montato da React, non su React stesso: le stesse funzioni
 * valgono per tutte e quattro le schermate, ed e' l'unico modo per restare
 * disaccoppiati da come ciascuna schermata e' costruita internamente.
 *
 * Gli input controllati (slider, seed) vanno mossi passando dal setter nativo
 * di `value` e non dalla semplice assegnazione: React intercetta l'assegnazione
 * diretta e la ignora, perche' il suo tracking interno del valore precedente non
 * cambia. Il giro attraverso il prototipo e' il modo con cui un evento sintetico
 * puo' comunque risultare "cambiato" agli occhi di React.
 */

export interface Cursor {
  /** L'elemento rispetto a cui le coordinate del cursore sono calcolate. */
  root: HTMLElement;
  el: HTMLDivElement;
  pos: { x: number; y: number };
}

const ARROW_SVG = `
  <svg width="22" height="22" viewBox="0 0 20 20" style="display:block; filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));">
    <path d="M2 1 L2 15.5 L5.8 12 L8.2 17.7 L10.5 16.6 L8.1 11 L13.3 10.8 Z"
          fill="#f2f2f4" stroke="#08080a" stroke-width="1.2" stroke-linejoin="round" />
  </svg>`;

export function mountCursor(root: HTMLElement, start = { x: 40, y: 40 }): Cursor {
  if (getComputedStyle(root).position === "static") {
    root.style.position = "relative";
  }
  const el = document.createElement("div");
  el.style.cssText =
    `position:absolute; left:0; top:0; z-index:2147483000; pointer-events:none; ` +
    `will-change:transform; transform:translate(${start.x}px,${start.y}px);`;
  el.innerHTML = ARROW_SVG;
  root.appendChild(el);
  return { root, el, pos: { ...start } };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function centerOf(el: Element, root: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const s = root.getBoundingClientRect();
  return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function moveTo(cursor: Cursor, x: number, y: number, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const start = { ...cursor.pos };
    const t0 = performance.now();
    function frame(now: number) {
      const t = Math.min(1, (now - t0) / Math.max(1, duration));
      const e = ease(t);
      const cx = start.x + (x - start.x) * e;
      const cy = start.y + (y - start.y) * e;
      cursor.el.style.transform = `translate(${cx}px,${cy}px)`;
      cursor.pos = { x: cx, y: cy };
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

export async function moveToElement(cursor: Cursor, el: Element, duration = 650): Promise<void> {
  const { x, y } = centerOf(el, cursor.root);
  await moveTo(cursor, x, y, duration);
}

export function clickFx(cursor: Cursor): void {
  const ripple = document.createElement("div");
  ripple.style.cssText =
    `position:absolute; left:${cursor.pos.x}px; top:${cursor.pos.y}px; width:8px; height:8px; ` +
    `margin:-4px 0 0 -4px; border-radius:50%; background:#4c8dff; border:1.5px solid rgba(255,255,255,.4); ` +
    `z-index:2147482999; pointer-events:none; transition:transform .4s ease-out, opacity .4s ease-out;`;
  cursor.root.appendChild(ripple);
  requestAnimationFrame(() => {
    ripple.style.transform = "scale(4)";
    ripple.style.opacity = "0";
  });
  setTimeout(() => ripple.remove(), 420);

  const svg = cursor.el.querySelector("svg");
  if (svg instanceof SVGElement) {
    svg.style.transform = "scale(0.8)";
    setTimeout(() => {
      svg.style.transform = "scale(1)";
    }, 130);
  }
}

/** Muove il cursore su `el`, simula il click visivamente, poi lo attiva davvero. */
export async function clickElement(
  cursor: Cursor,
  el: HTMLElement,
  opts: { duration?: number; settle?: number } = {},
): Promise<void> {
  await moveToElement(cursor, el, opts.duration ?? 650);
  clickFx(cursor);
  await wait(90);
  el.click();
  await wait(opts.settle ?? 260);
}

/** Il giro dal prototipo nativo che rende un input "cambiato" agli occhi di React. */
export function setNativeValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Digita carattere per carattere in un campo di testo controllato. */
export async function typeInto(
  cursor: Cursor,
  input: HTMLInputElement,
  text: string,
  opts: { duration?: number } = {},
): Promise<void> {
  await moveToElement(cursor, input, opts.duration ?? 550);
  clickFx(cursor);
  input.focus();
  setNativeValue(input, "");
  for (const ch of text) {
    setNativeValue(input, input.value + ch);
    await wait(55 + Math.random() * 45);
  }
  await wait(250);
}

/**
 * "Trascina" uno slider nativo verso `to`, muovendo il cursore lungo la barra
 * e aggiornando il valore a piccoli passi — un vero drag non e' simulabile con
 * eventi sintetici sugli input nativi, quindi l'effetto visivo e il cambio di
 * stato sono prodotti insieme, passo per passo.
 */
export async function dragRange(
  cursor: Cursor,
  input: HTMLInputElement,
  to: number,
  opts: { duration?: number; steps?: number } = {},
): Promise<void> {
  const min = Number(input.min || "0");
  const max = Number(input.max || "100");
  const from = Number(input.value);
  const steps = Math.max(1, opts.steps ?? 10);
  const duration = opts.duration ?? 900;

  const xFor = (value: number) => {
    const r = input.getBoundingClientRect();
    const s = cursor.root.getBoundingClientRect();
    const ratio = max > min ? (value - min) / (max - min) : 0;
    const thumb = 7; // il raggio del pallino nativo, lasciato libero ai due estremi
    return r.left - s.left + thumb + ratio * (r.width - thumb * 2);
  };
  const y = () => {
    const r = input.getBoundingClientRect();
    const s = cursor.root.getBoundingClientRect();
    return r.top - s.top + r.height / 2;
  };

  await moveTo(cursor, xFor(from), y(), 450);
  for (let i = 1; i <= steps; i++) {
    const value = from + ((to - from) * i) / steps;
    await moveTo(cursor, xFor(value), y(), duration / steps);
    setNativeValue(input, String(value));
  }
  setNativeValue(input, String(to));
}

export function highlight(el: HTMLElement, ms = 900): void {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "2px solid #4c8dff";
  el.style.outlineOffset = "2px";
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  }, ms);
}

/**
 * Aspetta un ciclo run→idle di un bottone reale collegato al backend.
 *
 * Non c'e' un tempo fisso da aspettare: il run e' vero, gira sul motore reale,
 * e la sua durata dipende dai parametri e dalla macchina. Si aspetta prima che
 * il bottone mostri l'etichetta "occupato", poi che torni quella di riposo.
 */
export async function waitForRunCycle(
  button: HTMLElement,
  busyLabel: string,
  opts: { armTimeout?: number; doneTimeout?: number } = {},
): Promise<void> {
  const armTimeout = opts.armTimeout ?? 4000;
  const doneTimeout = opts.doneTimeout ?? 180000;
  const text = () => button.textContent?.trim() ?? "";

  const t0 = performance.now();
  while (text() !== busyLabel) {
    if (performance.now() - t0 > armTimeout) return;
    await wait(60);
  }
  const t1 = performance.now();
  while (text() === busyLabel) {
    if (performance.now() - t1 > doneTimeout) return;
    await wait(120);
  }
}

/** L'opzione di un `Segmented` (role="radio") il cui testo visibile e' `label`. */
export function radioOption(container: Element, label: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('button[role="radio"]')].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`demo: opzione "${label}" non trovata nel gruppo`);
  return found;
}

export function query<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`demo: elemento non trovato per il selettore "${selector}"`);
  return el;
}

export function queryOptional<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T | null {
  return root.querySelector<T>(selector);
}
