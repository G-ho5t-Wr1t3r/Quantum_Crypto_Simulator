/**
 * The control panel.
 *
 * Its job is to make an illegal run hard to express. The channel offers γ or a
 * length but never both, because the backend refuses both; positions are only
 * those the chosen attack declares valid, taken from `/plugins` rather than
 * hard-coded; and the CHSH confidence appears only for the protocol that has a
 * Bell parameter to be confident about. A form that lets someone build a
 * configuration the server will reject has wasted their time.
 */

import { Kicker, RunButton, Segmented, Slider } from "../../components/controls";
import { LangSwitch, ThemeSwitch } from "../../components/AppearanceControls";
import type { Plugins, ProtocolKind } from "../../api/contract";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { gammaFromLength } from "../../lib/physics";
import { PRESETS, type Params, type PresetId } from "./state";

const SECTION = {
  padding: "18px 22px",
  borderBottom: "1px solid var(--line)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 14,
};

function ProtocolCard({
  name,
  sub,
  active,
  onClick,
}: {
  name: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 3,
        padding: "11px 13px",
        borderRadius: 12,
        border: `1px solid ${active ? "var(--line-2)" : "var(--line)"}`,
        background: active ? "var(--panel-2)" : "var(--panel)",
        color: "var(--fg)",
        cursor: "pointer",
        textAlign: "left",
        boxShadow: active ? "0 6px 18px -14px #000, inset 0 1px 0 var(--hi)" : "none",
        transition: "background .16s ease",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
      <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{sub}</span>
    </button>
  );
}

/** A miniature of the topology, so a preset can be recognised without reading. */
function PresetGlyph({ id }: { id: Exclude<PresetId, "custom"> }) {
  const shape = PRESETS[id];
  const count = shape.nodes.length;
  return (
    <span style={{ position: "relative", width: 52, height: 18, flex: "none" }}>
      <span style={{ position: "absolute", left: 5, right: 5, top: 8, height: 1, background: "var(--line-2)" }} />
      {shape.nodes.map((_, index) => {
        const fraction = count === 1 ? 0.5 : index / (count - 1);
        const color =
          index === 0 ? "var(--blue)" : index === count - 1 ? "var(--mint)" : id === "epr" ? "var(--purple)" : "var(--red)";
        return (
          <span
            key={index}
            style={{
              position: "absolute",
              top: 5,
              left: 5 + fraction * 42,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color,
              boxShadow: `0 0 6px -1px ${color}`,
            }}
          />
        );
      })}
    </span>
  );
}

export function Sidebar({
  params,
  set,
  preset,
  applyPreset,
  plugins,
  busy,
  onRun,
  onReset,
  onCopy,
  copied,
}: {
  params: Params;
  set: <K extends keyof Params>(key: K, value: Params[K]) => void;
  preset: PresetId;
  applyPreset: (id: Exclude<PresetId, "custom">) => void;
  plugins: Plugins | undefined;
  busy: boolean;
  onRun: () => void;
  onReset: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const t = useCopy();
  const locale = useLocale();
  const isBB84 = params.protocol === "bb84";
  const attacking = params.attackKind !== "none";

  // Straight from the backend: an attack may only be performed from the
  // positions it declares, so offering the others would be offering a 422.
  const validPositions = plugins?.attacks[params.attackKind] ?? ["channel"];

  return (
    <aside
      style={{
        background: "var(--bg-2)",
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        maxHeight: "100vh",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "20px 22px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-.02em" }}>{t.brand}</span>
          <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{t.subtitle}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <LangSwitch />
          <ThemeSwitch />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <section style={{ ...SECTION, gap: 10 }}>
          <Kicker>{t.protocol}</Kicker>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <ProtocolCard
              name="BB84"
              sub={t.bb84sub}
              active={isBB84}
              onClick={() => set("protocol", "bb84" as ProtocolKind)}
            />
            <ProtocolCard
              name="E91"
              sub={t.e91sub}
              active={!isBB84}
              // E91 needs a source between the two parties; switching without
              // moving the topology would draw a protocol nobody runs.
              onClick={() => applyPreset("epr")}
            />
          </div>
        </section>

        <section style={{ ...SECTION, gap: 10 }}>
          <Kicker>{t.topology}</Kicker>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(["pair", "eve", "epr", "blank"] as const).map((id) => {
              const [label, description] = t.presets[id];
              const active = preset === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${active ? "var(--line-2)" : "var(--line)"}`,
                    background: active ? "var(--panel-2)" : "var(--panel)",
                    color: "var(--fg)",
                    cursor: "pointer",
                    boxShadow: active ? "inset 0 1px 0 var(--hi)" : "none",
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left", minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.35 }}>{description}</span>
                  </span>
                  <PresetGlyph id={id} />
                </button>
              );
            })}
          </div>
        </section>

        <section style={SECTION}>
          <Kicker>{t.channel}</Kicker>
          <Segmented
            wide
            options={[
              { id: "ideal" as const, label: t.ideal },
              { id: "amplitude_damping" as const, label: t.damping },
            ]}
            value={params.channelKind}
            onChange={(value) => set("channelKind", value)}
          />
          {params.channelKind !== "ideal" && (
            <>
              {/* Two descriptions of one channel. Exactly one is sent. */}
              <Segmented
                wide
                options={[
                  { id: "gamma" as const, label: t.byGamma },
                  { id: "length_km" as const, label: t.byKm },
                ]}
                value={params.channelMode}
                onChange={(value) => set("channelMode", value)}
              />
              {params.channelMode === "gamma" ? (
                <Slider
                  label={t.gamma}
                  display={params.gamma.toFixed(3)}
                  hint={t.gammaHint}
                  min={0}
                  max={0.5}
                  step={0.005}
                  value={params.gamma}
                  onChange={(value) => set("gamma", value)}
                />
              ) : (
                <Slider
                  label={t.lengthKm}
                  display={`${params.km} km → γ ${gammaFromLength(params.km).toFixed(3)}`}
                  hint={t.kmHint}
                  min={0}
                  max={120}
                  step={1}
                  value={params.km}
                  onChange={(value) => set("km", value)}
                />
              )}
            </>
          )}
        </section>

        <section style={SECTION}>
          <Kicker>{t.attack}</Kicker>
          <Segmented
            wide
            options={[
              { id: "none" as const, label: t.noAttack },
              { id: "intercept_resend" as const, label: t.interceptResend },
            ]}
            value={params.attackKind}
            onChange={(value) => set("attackKind", value)}
          />
          {attacking && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>{t.position}</span>
                <Segmented
                  wide
                  options={[
                    { id: "channel" as const, label: t.posChannel },
                    { id: "endpoint" as const, label: t.posEndpoint },
                  ].filter((option) => validPositions.includes(option.id))}
                  value={params.position}
                  onChange={(value) => set("position", value)}
                />
              </div>
              <Slider
                label={t.fraction}
                display={`${(params.fraction * 100).toFixed(0)} %`}
                hint={t.fractionHint}
                min={0}
                max={1}
                step={0.01}
                value={params.fraction}
                onChange={(value) => set("fraction", value)}
              />
            </>
          )}
        </section>

        <section style={SECTION}>
          <Kicker>{t.run}</Kicker>
          <Slider
            label={t.qubits}
            display={params.nQubits.toLocaleString(locale)}
            hint={t.qubitsHint}
            min={200}
            max={20000}
            step={100}
            value={params.nQubits}
            onChange={(value) => set("nQubits", value)}
          />
          <Slider
            label={t.trials}
            display={String(params.trials)}
            hint={t.trialsHint}
            min={1}
            max={20}
            step={1}
            value={params.trials}
            onChange={(value) => set("trials", value)}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{t.seed}</span>
              <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{t.seedRequired}</span>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <input
                value={params.seed}
                aria-label={t.seed}
                onChange={(event) =>
                  set("seed", parseInt(event.target.value.replace(/\D/g, "") || "0", 10))
                }
                className="mono"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  padding: "9px 11px",
                  color: "var(--fg)",
                  fontSize: 12.5,
                  outline: "none",
                }}
              />
              <button
                type="button"
                title={t.randomize}
                onClick={() => set("seed", Math.floor(Math.random() * 9e7) + 1e7)}
                style={{
                  flex: "none",
                  width: 38,
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  background: "var(--panel-2)",
                  color: "var(--fg-2)",
                  cursor: "pointer",
                  fontSize: 14,
                  boxShadow: "inset 0 1px 0 var(--hi)",
                }}
              >
                ⟳
              </button>
            </div>
          </div>
        </section>

        <section style={{ ...SECTION, borderBottom: "none", paddingBottom: 22 }}>
          <Kicker>{t.security}</Kicker>
          <Slider
            label={t.threshold}
            display={params.qberThreshold.toFixed(3)}
            hint={t.thresholdHint}
            min={0.02}
            max={0.3}
            step={0.005}
            value={params.qberThreshold}
            onChange={(value) => set("qberThreshold", value)}
          />
          {!isBB84 && (
            <Slider
              label={t.confidence}
              display={`${params.chshConfidence} σ`}
              hint={t.confidenceHint}
              min={1}
              max={6}
              step={1}
              value={params.chshConfidence}
              onChange={(value) => set("chshConfidence", value)}
            />
          )}
          <button
            type="button"
            onClick={onCopy}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--panel-2)",
              color: "var(--fg-2)",
              padding: 10,
              fontSize: 12,
              cursor: "pointer",
              boxShadow: "inset 0 1px 0 var(--hi)",
            }}
          >
            {copied ? t.copied : t.copyConfig}
          </button>
        </section>
      </div>

      <div
        style={{
          padding: "14px 22px 18px",
          borderTop: "1px solid var(--line)",
          background: "var(--panel)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <RunButton label={busy ? `${t.running}…` : t.runNow} busy={busy} onClick={onRun} />
        <button
          type="button"
          onClick={onReset}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--fg-3)",
            fontSize: 11.5,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {t.reset}
        </button>
      </div>
    </aside>
  );
}
