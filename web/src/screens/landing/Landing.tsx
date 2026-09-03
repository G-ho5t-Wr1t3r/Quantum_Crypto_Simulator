/**
 * The landing page: eight scroll beats, then a choice of protocol.
 *
 * One scroll container holds a sticky full-height stage and a content column
 * pulled up over it. The copy lives in the left 44–46% and the animation owns
 * the right, which is why the stage carries a horizontal scrim: the text has to
 * stay legible over whatever is happening behind it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppearance, useReducedMotion } from "../../app/appearance";
import { LangInline } from "../../components/AppearanceControls";
import { ThemeToggle } from "../../components/ScreenTabs";
import { Footer } from "../../components/Footer";
import { useCopy } from "../../i18n/useCopy";
import { beatsFor } from "./beats";
import { Stage } from "./Stage";

/**
 * Durata dell'espansione del pannello.
 *
 * Corta di proposito: l'overlay è opaco, quindi ogni millisecondo in più è un
 * millisecondo passato a guardare un rettangolo pieno invece della schermata
 * che si sta aprendo. La rotta cambia appena l'espansione ha coperto tutto.
 */
const WIPE_MS = 300;

export default function Landing() {
  const t = useCopy();
  const navigate = useNavigate();
  const { theme } = useAppearance();
  const reduced = useReducedMotion();

  const root = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const glide = useRef(0);
  /** Alzato mentre la pagina si sposta da sola: letto dallo scroll handler. */
  const gliding = useRef(false);
  const [snapOff, setSnapOff] = useState(false);
  const [progress, setProgress] = useState(0);
  const [metrics, setMetrics] = useState({ width: 1200, height: 800, scrollHeight: 8000 });
  /**
   * Il rettangolo da cui parte l'espansione, in coordinate di viewport.
   *
   * L'apertura è un `clip-path` che passa dal riquadro del pannello a tutto lo
   * schermo: si anima sul compositor e non tocca il layout, a differenza di
   * left/top/width/height.
   */
  const [wipe, setWipe] = useState<{ inset: string; open: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () =>
      setMetrics({ width: element.clientWidth, height: element.clientHeight, scrollHeight: element.scrollHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    // Coalesced into a frame: scroll fires far more often than the screen
    // repaints, and recomputing the whole scene per event buys nothing.
    const onScroll = () => {
      // Durante lo scorrimento automatico è lo step a fissare `progress`, nello
      // stesso frame in cui scrive scrollTop: passare anche di qui aggiungerebbe
      // un frame di ritardo fra la posizione reale e la scena disegnata.
      if (gliding.current || raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const span = Math.max(1, element.scrollHeight - element.clientHeight);
        setProgress(Math.min(1, Math.max(0, element.scrollTop / span)));
        setMetrics((current) => ({ ...current, scrollHeight: element.scrollHeight }));
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  useEffect(() => () => cancelAnimationFrame(glide.current), []);

  /**
   * A long eased ride rather than a jump.
   *
   * The buttons scroll past six beats of animation, and teleporting there would
   * skip the argument the page is making. Reduced motion gets the jump instead,
   * which is the point of the preference.
   */
  const glideTo = useCallback(
    (selector: string) => {
      const container = root.current;
      const target = container?.querySelector(selector);
      if (!container || !target) return;
      const from = container.scrollTop;
      const to = from + target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      if (reduced) {
        container.scrollTop = to;
        return;
      }
      const duration = Math.min(6500, Math.max(1800, Math.abs(to - from) * 1.15));
      const start = performance.now();
      cancelAnimationFrame(glide.current);

      // Lo snap va spento per la durata del viaggio. Ogni frame qui scrive
      // scrollTop senza che ci sia un gesto in corso, e il browser considera
      // quello scroll concluso: con lo snap attivo riaggancia alla sezione più
      // vicina, il frame dopo noi riportiamo la posizione avanti, e il risultato
      // è l'oscillazione che si vede come scatto.
      gliding.current = true;
      setSnapOff(true);

      const stop = () => {
        gliding.current = false;
        setSnapOff(false);
        cancelAnimationFrame(glide.current);
        container.removeEventListener("wheel", stop);
        container.removeEventListener("touchstart", stop);
      };
      // Se l'utente riprende in mano lo scroll, il viaggio si ferma: continuare a
      // riportarlo dove vogliamo noi significherebbe contendergli la pagina.
      container.addEventListener("wheel", stop, { passive: true, once: true });
      container.addEventListener("touchstart", stop, { passive: true, once: true });

      const span = Math.max(1, container.scrollHeight - container.clientHeight);
      const step = (now: number) => {
        const u = Math.min(1, (now - start) / duration);
        const eased = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const top = from + (to - from) * eased;
        container.scrollTop = top;
        setProgress(Math.min(1, Math.max(0, top / span)));
        if (u < 1) glide.current = requestAnimationFrame(step);
        else stop();
      };
      glide.current = requestAnimationFrame(step);
    },
    [reduced],
  );

  const openProtocol = useCallback(
    (which: "bb84" | "e91", from?: HTMLElement) => {
      const go = () => navigate(`/run?protocol=${which}`);
      if (reduced || !from) {
        go();
        return;
      }
      const r = from.getBoundingClientRect();
      const radius = getComputedStyle(from).borderRadius;
      setWipe({
        inset: `inset(${r.top}px ${window.innerWidth - r.right}px ${window.innerHeight - r.bottom}px ${r.left}px round ${radius})`,
        open: false,
      });
      // Due frame: il primo dipinge il riquadro di partenza, il secondo fa
      // scattare la transizione. Con uno solo il browser accorpa i due stati e
      // l'espansione non si vede affatto.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setWipe((current) => (current ? { ...current, open: true } : current))),
      );
      window.setTimeout(go, WIPE_MS);
    },
    [navigate, reduced],
  );

  const beats = beatsFor(progress, metrics.height, metrics.scrollHeight);
  // Durante l'espansione la scena è coperta: continuare a ricalcolarla toglie
  // frame all'unica animazione che si sta ancora vedendo.
  const stageHidden = wipe !== null;

  return (
    <div
      ref={root}
      style={{
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--bg)",
        color: "var(--fg)",
        scrollSnapType: snapOff ? "none" : "y proximity",
      }}
    >
      {!stageHidden && (
        <Stage beats={beats} width={metrics.width} height={metrics.height} dark={theme === "dark"} reduced={reduced} />
      )}

      <div style={{ marginTop: "-100vh", position: "relative", zIndex: 2 }}>
        <section
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 8vw",
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: "min(46%, 600px)", display: "flex", flexDirection: "column", gap: 22 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(34px, 4.6vw, 64px)",
                lineHeight: 1.04,
                fontWeight: 600,
                letterSpacing: "-.035em",
              }}
            >
              {t.heroTitle}
            </h1>
            <p style={{ margin: 0, fontSize: "clamp(14px, 1.25vw, 17px)", lineHeight: 1.6, color: "var(--fg-2)" }}>
              {t.heroSub}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", pointerEvents: "auto" }}>
              <button
                type="button"
                onClick={() => glideTo("#protocols")}
                style={{
                  padding: "12px 20px",
                  borderRadius: 11,
                  border: "none",
                  background: "var(--blue)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 590,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  boxShadow: "0 10px 24px -16px #000, inset 0 1px 0 rgba(255,255,255,.22)",
                }}
              >
                {t.ctaPrimary}
              </button>
              <button
                type="button"
                onClick={() => glideTo("#model")}
                style={{
                  padding: "12px 20px",
                  borderRadius: 11,
                  border: "1px solid var(--line)",
                  background: "var(--panel-2)",
                  color: "var(--fg)",
                  fontSize: 14,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  boxShadow: "inset 0 1px 0 var(--hi)",
                }}
              >
                {t.ctaSecondary}
              </button>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginTop: 10,
                animation: reduced ? "none" : "qhint 2.4s ease-in-out infinite",
              }}
            >
              <span style={{ width: 1, height: 22, background: "linear-gradient(var(--fg-2), transparent)" }} />
              <span style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{t.scrollHint}</span>
            </div>
          </div>
        </section>

        {t.story.map((beat, beatIndex) => (
          <section
            key={beatIndex}
            style={{
              minHeight: "170vh",
              display: "flex",
              alignItems: "center",
              padding: "0 8vw",
              pointerEvents: "none",
              scrollSnapAlign: "start",
              scrollSnapStop: "normal",
            }}
          >
            {/* Un beat senza titolo è muto di proposito: la sezione serve solo a
                dare all'animazione lo spazio per compiersi. Il campo `step` resta
                in copy.ts come etichetta d'ordine per chi legge il sorgente, ma
                non viene stampato. */}
            {beat.title && (
            <div style={{ maxWidth: "min(44%, 540px)", display: "flex", flexDirection: "column", gap: 15 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: "clamp(23px, 2.5vw, 36px)",
                  lineHeight: 1.12,
                  fontWeight: 600,
                  letterSpacing: "-.03em",
                }}
              >
                {beat.title}
              </h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.68, color: "var(--fg-2)" }}>{beat.body}</p>
              {beat.note && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    paddingTop: 4,
                    borderTop: "1px solid var(--line)",
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      marginTop: 9,
                      background: "var(--orange)",
                      boxShadow: "0 0 7px -1px var(--orange)",
                      flex: "none",
                    }}
                  />
                  <span
                    className="mono"
                    style={{ fontSize: 11.5, lineHeight: 1.65, color: "var(--fg-2)", paddingTop: 3 }}
                  >
                    {beat.note}
                  </span>
                </div>
              )}
            </div>
            )}
          </section>
        ))}

        <section
          id="model"
          style={{
            minHeight: "140vh",
            padding: "14vh 8vw",
            display: "flex",
            alignItems: "flex-start",
            pointerEvents: "none",
            scrollSnapAlign: "start",
          }}
        >
          <div style={{ maxWidth: "min(46%, 560px)", display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: "clamp(24px, 2.7vw, 38px)",
                  lineHeight: 1.12,
                  fontWeight: 600,
                  letterSpacing: "-.03em",
                }}
              >
                {t.modelTitle}
              </h2>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.68, color: "var(--fg-2)" }}>{t.modelBody}</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, pointerEvents: "auto" }}>
              {t.cards.map((card, cardIndex) => (
                <div
                  key={card.title}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 16,
                    background: "color-mix(in oklab, var(--panel) 92%, transparent)",
                    padding: "18px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    boxShadow: "inset 0 1px 0 var(--hi)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{card.title}</span>
                    <span
                      className="mono"
                      style={{
                        padding: "3px 9px",
                        borderRadius: 20,
                        border: "1px solid var(--line)",
                        background: "var(--seg)",
                        color: "var(--fg-2)",
                        fontSize: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {card.tag}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {card.steps.map(([label, value], stepIndex) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            flex: "none",
                            background: ["var(--blue)", "var(--purple)", "var(--mint)", "var(--orange)", "var(--grey)"][
                              (stepIndex + cardIndex) % 5
                            ],
                          }}
                        />
                        <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-2)" }}>
                          {label}
                        </span>
                        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
                        <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)", whiteSpace: "nowrap" }}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                  {card.foot && (
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-3)" }}>{card.foot}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="protocols"
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg)",
            scrollSnapAlign: "start",
            scrollSnapStop: "normal",
          }}
        >
          <div style={{ padding: "9vh 8vw 4vh", display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
            <h2
              style={{
                margin: 0,
                fontSize: "clamp(26px, 3vw, 40px)",
                lineHeight: 1.12,
                fontWeight: 600,
                letterSpacing: "-.03em",
              }}
            >
              {t.chooseTitle}
            </h2>
            {t.chooseBody && (
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--fg-2)" }}>{t.chooseBody}</p>
            )}
          </div>
          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 2,
              minHeight: "56vh",
              padding: "0 8vw 9vh",
            }}
          >
            {t.panels.map((panel, index) => {
              const which = index === 0 ? ("bb84" as const) : ("e91" as const);
              const color = index === 0 ? "var(--blue)" : "var(--purple)";
              return (
                <div
                  key={panel.name}
                  onClick={(event) => openProtocol(which, event.currentTarget)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") openProtocol(which, event.currentTarget);
                  }}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 28,
                    padding: 34,
                    borderRadius: index === 0 ? "18px 4px 4px 18px" : "4px 18px 18px 4px",
                    border: "1px solid var(--line)",
                    background: "var(--panel)",
                    cursor: "pointer",
                    boxShadow: "inset 0 1px 0 var(--hi)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: `radial-gradient(70% 60% at ${index === 0 ? "18%" : "82%"} 22%, color-mix(in oklab, ${color} 26%, transparent), transparent 70%)`,
                      opacity: 0.45,
                      pointerEvents: "none",
                    }}
                  />
                  <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10, zIndex: 2 }}>
                    <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", color: "var(--fg-2)" }}>
                      {panel.kicker}
                    </span>
                    <span
                      style={{
                        fontSize: "clamp(34px, 4vw, 54px)",
                        fontWeight: 600,
                        letterSpacing: "-.03em",
                        lineHeight: 1,
                      }}
                    >
                      {panel.name}
                    </span>
                    <span style={{ fontSize: 14, color: "var(--fg-2)", maxWidth: "34ch", lineHeight: 1.55 }}>
                      {panel.body}
                    </span>
                  </div>
                  <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, zIndex: 2 }}>
                    <span
                      style={{
                        padding: "9px 16px",
                        borderRadius: 11,
                        background: color,
                        color: "#fff",
                        fontSize: 12.5,
                        fontWeight: 590,
                        whiteSpace: "nowrap",
                        boxShadow: "0 10px 22px -16px #000, inset 0 1px 0 rgba(255,255,255,.24)",
                      }}
                    >
                      {t.ctaLabel}
                    </span>
                    {panel.meta && (
                      <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
                        {panel.meta}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Required: without it the last full-height section keeps recapturing
            the snap and the footer cannot be reached. */}
        <div style={{ scrollSnapAlign: "end" }}>
          <Footer />
        </div>
      </div>

      {/* Preferenze d'aspetto, in alto a destra e volutamente defilate: non sono
          il contenuto della pagina e non devono competere con il titolo. Nessuna
          ombra e sfondo quasi trasparente, così la barra appartiene alla pagina
          invece di stare appoggiata sopra. */}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 6px 4px 12px",
          borderRadius: 999,
          border: "1px solid color-mix(in oklab, var(--line) 55%, transparent)",
          background: "color-mix(in oklab, var(--panel) 55%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <LangInline />
        <ThemeToggle size={26} round bare />
      </div>

      <div
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          height: 2,
          width: `${(progress * 100).toFixed(2)}%`,
          background: "linear-gradient(90deg, var(--blue), var(--mint))",
          boxShadow: "0 0 12px -2px var(--blue)",
          zIndex: 11,
          transition: "width .12s linear",
        }}
      />

      {wipe && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20,
            background: "var(--bg)",
            pointerEvents: "none",
            clipPath: wipe.open ? "inset(0px round 0px)" : wipe.inset,
            transition: `clip-path ${WIPE_MS}ms cubic-bezier(.22, .61, .36, 1)`,
            willChange: "clip-path",
            transform: "translateZ(0)",
          }}
        />
      )}

    </div>
  );
}
