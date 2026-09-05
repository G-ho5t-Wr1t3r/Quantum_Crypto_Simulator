/**
 * Entry point dell'iframe registrabile.
 *
 * Un secondo file HTML Vite (`demo-frame.html`), separato da `index.html`: non
 * e' mai incluso nella build di produzione (di default Vite impacchetta solo
 * `index.html`) e non e' raggiungibile dall'app reale, che non lo nomina da
 * nessuna parte.
 */

import { createRoot } from "react-dom/client";

import { FrameApp } from "./FrameApp";
import { isDemoScreen } from "./screens";

const requested = new URLSearchParams(window.location.search).get("screen");
const screen = isDemoScreen(requested) ? requested : "configuration";

createRoot(document.getElementById("frame-root")!).render(<FrameApp screen={screen} />);
