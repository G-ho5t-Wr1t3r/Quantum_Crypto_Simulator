/**
 * Everything the person running this can change without editing a file.
 *
 * Two unrelated kinds of thing, together because they answer the same question
 * — "where do I change that?": the limits the service enforces, and the contact
 * details the landing page prints. The first are written back to the server and
 * take effect on the next request; the second are only ever displayed.
 *
 * The bounds on the number fields come from the service's own schema by way of
 * its models, so the panel cannot offer a value the server would refuse.
 */

import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAppConfig, useSaveConfig } from "../api/queries";
import type { AppConfig } from "../api/contract";
import { useAppearance } from "../app/appearance";
import { useCopy } from "../i18n/useCopy";
import { Banner } from "./Banner";
import { Confirm } from "./Confirm";
import { Footer } from "./Footer";
import { Modal } from "./Modal";
import { Kicker, Segmented, Slider } from "./controls";
import type { Lang } from "../app/appearance";

export function Settings({ onClose }: { onClose: () => void }) {
  const t = useCopy();
  const { lang, setLang } = useAppearance();
  const config = useAppConfig();
  const save = useSaveConfig();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Edited on a copy, so an abandoned dialog changes nothing.
  useEffect(() => {
    if (config.data && !draft) setDraft(structuredClone(config.data));
  }, [config.data, draft]);

  const limit = <K extends keyof AppConfig["limits"]>(key: K, value: number) =>
    setDraft((current) => (current ? { ...current, limits: { ...current.limits, [key]: value } } : current));

  return (
    <Modal
      title={t.settings}
      closeLabel={t.close}
      onClose={onClose}
      width="min(760px, 100%)"
      actions={
        draft && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={save.isPending}
            style={{
              padding: "7px 16px",
              borderRadius: 9,
              border: "none",
              background: "var(--blue)",
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 590,
              cursor: save.isPending ? "default" : "pointer",
              boxShadow: "0 8px 20px -14px #000, inset 0 1px 0 rgba(255,255,255,.22)",
            }}
          >
            {save.isSuccess ? t.settingsSaved : t.settingsSave}
          </button>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22, paddingTop: 14, minWidth: 320 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Kicker>{t.settingsLanguage}</Kicker>
          <Segmented<Lang>
            wide
            label={t.settingsLanguage}
            options={[
              { id: "it", label: "Italiano" },
              { id: "en", label: "English" },
            ]}
            value={lang}
            onChange={setLang}
          />
        </div>

        {config.isError && <Banner tone="error">{t.backendDown}</Banner>}

        {draft && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Kicker>{t.settingsLimits}</Kicker>
              <Slider
                label={t.limitConcurrent}
                display={String(draft.limits.max_concurrent_runs)}
                hint={t.limitConcurrentHint}
                min={1}
                max={32}
                step={1}
                value={draft.limits.max_concurrent_runs}
                onChange={(value) => limit("max_concurrent_runs", value)}
              />
              <Slider
                label={t.limitHistory}
                display={String(draft.limits.run_history)}
                hint={t.limitHistoryHint}
                min={1}
                max={200}
                step={1}
                value={draft.limits.run_history}
                onChange={(value) => limit("run_history", value)}
              />
              <Slider
                label={t.limitSync}
                display={String(draft.limits.max_sync_qubits)}
                hint={t.limitSyncHint}
                min={50}
                max={2000}
                step={50}
                value={draft.limits.max_sync_qubits}
                onChange={(value) => limit("max_sync_qubits", value)}
              />
            </div>

            {save.isError && (
              <Banner tone="error">
                {save.error instanceof ApiError ? save.error.detail : String(save.error)}
              </Banner>
            )}
          </>
        )}

        {/* Set apart: the panel above is settings, this is what they produce. */}
        <div style={{ height: 18 }} />

        {/* The footer itself, not a form for it: it is what those settings
            produce, and showing the result is more use than five text inputs
            that get filled in once. Bled to the edges so it reads as the foot of
            the panel rather than a box inside it. */}
        <div style={{ margin: "8px -20px -20px", borderTop: "1px solid var(--line)" }}>
          <Footer />
        </div>
      </div>

      {confirming && draft && (
        <Confirm
          title={t.settingsConfirm}
          closeLabel={t.close}
          confirmLabel={t.settingsSave}
          cancelLabel={t.cancel}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            save.mutate(draft);
            setConfirming(false);
          }}
        >
          {t.settingsConfirmBody}
        </Confirm>
      )}
    </Modal>
  );
}
