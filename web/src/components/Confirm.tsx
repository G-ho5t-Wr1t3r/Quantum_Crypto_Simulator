/**
 * A second panel, over the one that asked for it.
 *
 * Used where an action reaches past the page it was taken on — writing to the
 * server, in this case. The point is not ceremony: it is that the consequence
 * gets stated at the moment of the decision, where it can still change it,
 * rather than sitting permanently beside a button as a notice nobody reads
 * after the first time.
 */

import type { ReactNode } from "react";

import { Modal } from "./Modal";

export function Confirm({
  title,
  closeLabel,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  closeLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <Modal title={title} closeLabel={closeLabel} onClose={onCancel} elevation={50} width="min(430px, 100%)">
      <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 12 }}>
        <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--fg-2)" }}>{children}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--panel-2)",
              color: "var(--fg-2)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "var(--blue)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 590,
              cursor: "pointer",
              boxShadow: "0 10px 24px -16px #000, inset 0 1px 0 rgba(255,255,255,.22)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
