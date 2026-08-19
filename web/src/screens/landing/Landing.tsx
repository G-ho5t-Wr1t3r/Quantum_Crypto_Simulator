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
import { LangSwitch, ThemeSwitch } from "../../components/AppearanceControls";
import { Footer } from "../../components/Footer";
import { useCopy } from "../../i18n/useCopy";
import { beatsFor } from "./beats";
import { Stage } from "./Stage";

/** How long the panel-expansion wipe runs before the route changes. */
const WIPE_MS = 620;

export default function Landing() {
  const t = useCopy();
  const navigate = useNavigate();
  const { theme } = useAppearance();
  const reduced = useReducedMotion();

  const root = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const glide = useRef(0);
  const [progress, setProgress] = useState(0);
  const [metrics, setMetrics] = useState({ width: 1200, height: 800, scrollHeight: 8000 });
  const [expanding, setExpanding] = useState<"bb84" | "e91" | null>(null);

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
      if (raf.current) return;
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
      const step = (now: number) => {
        const u = Math.min(1, (now - start) / duration);
        const eased = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        container.scrollTop = from + (to - from) * eased;
        if (u < 1) glide.current = requestAnimationFrame(step);
      };
      glide.current = requestAnimationFrame(step);
    },
    [reduced],
  );

  const openProtocol = useCallback(
    (which: "bb84" | "e91") => {
      setExpanding(which);
      window.setTimeout(() => navigate(`/run?protocol=${which}`), reduced ? 0 : WIPE_MS);
    },
    [navigate, reduced],
  );

  const beats = beatsFor(progress, metrics.height, metrics.scrollHeight);

  return (
    <div
      ref={root}
      style={{
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--bg)",
        color: "var(--fg)",
        scrollSnapType: "y proximity",
      }}
    >
      <Stage beats={beats} width={metrics.width} height={metrics.height} dark={theme === "dark"} reduced={reduced} />

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
            <span
              className="mono"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                alignSelf: "flex-start",
                padding: "6px 13px",
                borderRadius: 22,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                fontSize: 11,
                color: "var(--fg-2)",
                whiteSpace: "nowrap",
                boxShadow: "inset 0 1px 0 var(--hi)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--mint)",
                  boxShadow: "0 0 7px -1px var(--mint)",
                }}
              />
              {t.badge}
            </span>
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

        {t.story.map((beat) => (
          <section
            key={beat.step}
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
            <div style={{ maxWidth: "min(44%, 540px)", display: "flex", flexDirection: "column", gap: 15 }}>
              <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", color: "var(--blue)" }}>
                {beat.step}
              </span>
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
              <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", color: "var(--blue)" }}>
                {t.modelStep}
              </span>
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
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-3)" }}>{card.foot}</p>
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
            <span className="mono" style={{ fontSize: 11, letterSpacing: ".12em", color: "var(--blue)" }}>
              {t.chooseStep}
            </span>
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
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: "var(--fg-2)" }}>{t.chooseBody}</p>
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
              const active = expanding === which;
              return (
                <div
                  key={panel.name}
                  onClick={() => openProtocol(which)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") openProtocol(which);
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
                    transform: `scale(${active ? 1.06 : 1})`,
                    boxShadow: active
                      ? `0 40px 90px -40px #000, 0 0 0 1px ${color}`
                      : "inset 0 1px 0 var(--hi)",
                    transition: "transform .55s cubic-bezier(.32,.72,0,1), box-shadow .4s ease",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: `radial-gradient(70% 60% at ${index === 0 ? "18%" : "82%"} 22%, color-mix(in oklab, ${color} 26%, transparent), transparent 70%)`,
                      opacity: active ? 0.9 : 0.45,
                      transition: "opacity .4s ease",
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
                    <span className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>
                      {panel.meta}
                    </span>
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

      <div
        style={{
          position: "fixed",
          top: 18,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "7px 8px 7px 18px",
          borderRadius: 22,
          border: "1px solid var(--line)",
          background: "var(--panel)",
          boxShadow: "0 18px 40px -26px #000, inset 0 1px 0 var(--hi)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--blue)",
              boxShadow: "0 0 8px -1px var(--blue)",
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 590, whiteSpace: "nowrap" }}>QKD Simulator</span>
        </span>
        <span style={{ width: 1, height: 18, background: "var(--line)" }} />
        <LangSwitch />
        <ThemeSwitch />
        <button
          type="button"
          onClick={() => navigate("/run")}
          style={{
            padding: "8px 15px",
            borderRadius: 16,
            border: "none",
            background: "var(--fg)",
            color: "var(--bg)",
            fontSize: 12.5,
            fontWeight: 590,
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
          {t.navCta}
        </button>
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

      {expanding && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20,
            background: `radial-gradient(circle at ${expanding === "bb84" ? "28%" : "72%"} 62%, color-mix(in oklab, ${expanding === "bb84" ? "var(--blue)" : "var(--purple)"} 40%, transparent), var(--bg) 62%)`,
            animation: "qbreath .6s ease both",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
