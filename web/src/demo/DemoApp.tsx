/**
 * Il pannello esterno: sceglie la schermata e ospita il riquadro registrabile.
 *
 * Layout normale (flex), non `position:fixed`: il riquadro e il pannello sono
 * due blocchi affiancati, con il pannello staccato di netto dal bordo destro
 * del riquadro. Registrando solo il riquadro (crop fisso in OBS, selezione
 * area in QuickTime) il pannello non compare mai, nemmeno durante uno scroll o
 * un resize della finestra.
 *
 * La schermata vera vive in un iframe a parte (`demo-frame.html`): un iframe è
 * l'unico modo per far sì che le unità `vh` usate dalle schermate reali si
 * misurino sul riquadro (1920×1080) invece che sulla finestra del browser, che
 * quasi certamente ha un'altra dimensione.
 */

import { useEffect, useRef, useState } from "react";

import { DEMO_SCREENS, isDemoScreen, SCREEN_TITLES, type DemoScreen } from "./screens";

const FRAME_MARGIN_LEFT = 340;

function readScreen(): DemoScreen {
  const requested = new URLSearchParams(window.location.search).get("screen");
  return isDemoScreen(requested) ? requested : "configuration";
}

function readSize(): { width: number; height: number } {
  const params = new URLSearchParams(window.location.search);
  const width = Number(params.get("w"));
  const height = Number(params.get("h"));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

export function DemoApp() {
  const [screen] = useState(readScreen);
  const [size] = useState(readSize);
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const update = () => {
      const el = frameRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setOrigin({ x: Math.round(r.left), y: Math.round(r.top) });
    };
    update();
    const id = window.setInterval(update, 500);
    window.addEventListener("resize", update);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", update);
    };
  }, []);

  const replay = () => {
    iframeRef.current?.contentWindow?.location.reload();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        padding: 40,
        gap: 0,
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "#f4f4f6",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        ref={frameRef}
        style={{
          width: size.width,
          height: size.height,
          flex: "none",
          background: "#000",
          boxShadow: "0 0 0 1px #d8d8de",
        }}
      >
        <iframe
          ref={iframeRef}
          src={`/demo-frame.html?screen=${screen}`}
          title={SCREEN_TITLES[screen]}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
        />
      </div>

      <div
        style={{
          marginLeft: FRAME_MARGIN_LEFT,
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          gap: 22,
          color: "#1a1a1e",
        }}
      >
        <div>
          <h1 style={{ fontSize: 16, margin: "0 0 6px", fontWeight: 600 }}>
            Harness di registrazione — solo locale
          </h1>
          <p style={{ fontSize: 12.5, color: "#54545c", lineHeight: 1.6, margin: 0 }}>
            Tutto quello che vedi in questo pannello resta fuori dal riquadro nero a
            sinistra. Registrando solo quel riquadro — window/display capture con crop in
            OBS, o selezione area in QuickTime — i controlli non compaiono mai, nemmeno
            durante uno scroll o un resize della finestra.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a8a92" }}>
            Schermata in loop
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {DEMO_SCREENS.map((id) => (
              <a
                key={id}
                href={`?screen=${id}`}
                style={{
                  padding: "8px 11px",
                  borderRadius: 8,
                  border: `1px solid ${id === screen ? "#1a1a1e" : "#dcdce0"}`,
                  background: id === screen ? "#1a1a1e" : "#fff",
                  color: id === screen ? "#fff" : "#26262c",
                  fontSize: 12.5,
                  fontWeight: id === screen ? 600 : 450,
                  textDecoration: "none",
                }}
              >
                {SCREEN_TITLES[id]}
              </a>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={replay}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #1a1a1e",
            background: "#1a1a1e",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            width: "fit-content",
          }}
        >
          Riparti da capo
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: "#54545c", lineHeight: 1.6 }}>
          <span>La sequenza riparte da sola a fine giro: e' pensata per restare in loop mentre registri.</span>
          <span className="mono" style={{ fontFamily: "ui-monospace, monospace" }}>
            Riquadro {size.width}×{size.height}px, angolo in alto a sinistra a ({origin.x}, {origin.y})
            rispetto alla finestra del browser.
          </span>
          <span>
            Serve il backend acceso, come per <code>npm run dev</code>: le quattro schermate
            parlano con l'API vera, non con dati finti.
          </span>
        </div>
      </div>
    </div>
  );
}
