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

import { useState } from "react";

import { Kicker, RunButton, Segmented, Slider } from "../../components/controls";
import { SeedField } from "../../components/SeedField";
import type { Plugins, ProtocolKind } from "../../api/contract";
import { useSchemaBounds, within } from "../../api/queries";
import { useCopy, useLocale } from "../../i18n/useCopy";
import { lengthFromGamma } from "../../lib/physics";
import type { Params } from "./state";

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
  disabled,
  onClick,
}: {
  name: string;
  sub: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
        cursor: disabled ? "default" : "pointer",
        opacity: disabled && !active ? 0.5 : 1,
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

export function Sidebar({
  params,
  set,
  onProtocol,
  plugins,
  busy,
  onRun,
  onStop,
  onReset,
  onCopy,
  copied,
  copyFailed,
  configJson,
  onLoad,
}: {
  params: Params;
  set: <K extends keyof Params>(key: K, value: Params[K]) => void;
  /** Separate from `set`: changing protocol also clears the last result. */
  onProtocol: (protocol: ProtocolKind) => void;
  plugins: Plugins | undefined;
  busy: boolean;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onCopy: () => void;
  copied: boolean;
  /** True when neither clipboard route was allowed. */
  copyFailed: boolean;
  /** The configuration itself, for the reader to select when copying fails. */
  configJson: string;
  /** Adopt a pasted configuration; false when it could not be read. */
  onLoad: (raw: string) => boolean;
}) {
  const t = useCopy();
  const locale = useLocale();
  const isBB84 = params.protocol === "bb84";

  // The ranges below are a presentation choice; these are the limits the
  // backend actually enforces. Intersecting the two means a slider can never
  // reach a value the server would refuse, even if a bound is tightened there
  // later.
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState("");
  const [badPaste, setBadPaste] = useState(false);

  const bounds = useSchemaBounds();
  const range = (path: string, min: number, max: number) => within({ min, max }, bounds(path));
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
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <section style={{ ...SECTION, gap: 10 }}>
          <Kicker>{t.protocol}</Kicker>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <ProtocolCard
              name="BB84"
              sub={t.bb84sub}
              active={isBB84}
              disabled={busy}
              onClick={() => onProtocol("bb84")}
            />
            <ProtocolCard
              name="E91"
              sub={t.e91sub}
              active={!isBB84}
              disabled={busy}
              onClick={() => onProtocol("e91")}
            />
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
          disabled={busy}
          />
          {params.channelKind !== "ideal" && (
            // One control, both readings. γ drives because its range is bounded
            // and evenly useful; the length is what that γ means on a real
            // fibre, and it is what the reader actually pictures.
            <Slider
              label={t.attenuation}
              display={`γ ${params.gamma.toFixed(3)} · ${lengthFromGamma(params.gamma).toFixed(1)} km`}
              hint={t.attenuationHint}
              min={range("ChannelConfig.gamma", 0, 0.5).min}
              max={range("ChannelConfig.gamma", 0, 0.5).max}
              step={0.005}
              value={params.gamma}
              onChange={(value) => set("gamma", value)}
            disabled={busy}
            />
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
          disabled={busy}
          />
          {attacking && (
            <>
              {/* Only when there is something to choose. Intercept-resend
                  declares a single valid position, and a control with one
                  option is furniture — the diagram already shows where she
                  stands, by breaking the link she sits on. */}
              {validPositions.length > 1 && (
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
                  disabled={busy}
                  />
                </div>
              )}
              <Slider
                label={t.fraction}
                display={`${(params.fraction * 100).toFixed(0)} %`}
                hint={t.fractionHint}
                min={range("AttackConfig.fraction", 0, 1).min}
                max={range("AttackConfig.fraction", 0, 1).max}
                step={0.01}
                value={params.fraction}
                onChange={(value) => set("fraction", value)}
              disabled={busy}
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
            min={range("n_qubits", 200, 20000).min}
            max={range("n_qubits", 200, 20000).max}
            step={100}
            value={params.nQubits}
            onChange={(value) => set("nQubits", value)}
          disabled={busy}
          />
          <Slider
            label={t.trials}
            display={String(params.trials)}
            hint={t.trialsHint}
            min={range("trials", 1, 20).min}
            max={range("trials", 1, 20).max}
            step={1}
            value={params.trials}
            onChange={(value) => set("trials", value)}
          disabled={busy}
          />
          <SeedField value={params.seed} onChange={(seed) => set("seed", seed)} disabled={busy} />
        </section>

        <section style={{ ...SECTION, borderBottom: "none", paddingBottom: 22 }}>
          <Kicker>{t.security}</Kicker>
          {/* One or the other, never both. The engine judges BB84 on the error
              rate and E91 on the Bell parameter: the threshold it does not
              consult is a control that would do nothing. */}
          {isBB84 ? (
            <Slider
              label={t.threshold}
              // Shown as a percentage because every other error rate on the
              // screen is one, and comparing 0.110 with "10.34 %" by eye is a
              // conversion the reader should not have to do.
              display={`${(params.qberThreshold * 100).toFixed(1)} %`}
              hint={t.thresholdHint}
              min={range("SecurityPolicy.qber_threshold", 0.02, 0.3).min}
              max={range("SecurityPolicy.qber_threshold", 0.02, 0.3).max}
              step={0.005}
              value={params.qberThreshold}
              onChange={(value) => set("qberThreshold", value)}
            disabled={busy}
            />
          ) : (
            <Slider
              label={t.confidence}
              display={`${params.chshConfidence} σ`}
              hint={t.confidenceHint}
              min={range("SecurityPolicy.chsh_confidence", 1, 6).min}
              max={range("SecurityPolicy.chsh_confidence", 1, 6).max}
              step={1}
              value={params.chshConfidence}
              onChange={(value) => set("chshConfidence", value)}
            disabled={busy}
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

          {copyFailed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--orange)", lineHeight: 1.45 }}>{t.copyManual}</span>
              <textarea
                readOnly
                value={configJson}
                aria-label={t.copyConfig}
                rows={6}
                onFocus={(event) => event.target.select()}
                autoFocus
                className="mono"
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 9,
                  padding: "9px 11px",
                  color: "var(--fg)",
                  fontSize: 11.5,
                  resize: "vertical",
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* A field rather than a clipboard read: pasting into it always works,
              where `navigator.clipboard.readText` needs a permission the browser
              may simply refuse. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPasting((open) => !open);
              setBadPaste(false);
            }}
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
            {t.loadConfig}
          </button>

          {pasting && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.45 }}>{t.loadHint}</span>
              <textarea
                value={draft}
                aria-label={t.loadConfig}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setBadPaste(false);
                }}
                rows={6}
                className="mono"
                style={{
                  background: "var(--panel)",
                  border: `1px solid ${badPaste ? "var(--red)" : "var(--line)"}`,
                  borderRadius: 9,
                  padding: "9px 11px",
                  color: "var(--fg)",
                  fontSize: 11.5,
                  resize: "vertical",
                  outline: "none",
                }}
              />
              {badPaste && <span style={{ fontSize: 11, color: "var(--red)" }}>{t.loadInvalid}</span>}
              <button
                type="button"
                onClick={() => {
                  if (onLoad(draft)) {
                    setPasting(false);
                    setDraft("");
                  } else {
                    setBadPaste(true);
                  }
                }}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  background: "var(--panel-3)",
                  color: "var(--fg)",
                  padding: 9,
                  fontSize: 12,
                  fontWeight: 590,
                  cursor: "pointer",
                }}
              >
                {t.loadApply}
              </button>
            </div>
          )}
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
        <RunButton label={t.runNow} stopLabel={t.stop} busy={busy} onClick={onRun} onStop={onStop} />
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
