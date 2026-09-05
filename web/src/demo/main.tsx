/**
 * Entry point del pannello di registrazione.
 *
 * Un secondo file HTML Vite (`demo.html`), separato da `index.html` e mai
 * incluso nella build di produzione: `npm run build` impacchetta solo
 * `index.html` finche' `vite.config.ts` non elenca altri entry, e questo file
 * resta cosi' com'e'. Raggiungibile solo lanciandolo esplicitamente
 * (`npm run demo`, o visitando l'URL a mano): nessuna rotta o link dell'app lo
 * nomina.
 */

import { createRoot } from "react-dom/client";

import { DemoApp } from "./DemoApp";

createRoot(document.getElementById("demo-root")!).render(<DemoApp />);
