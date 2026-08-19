/**
 * What one participant saw, for the node that was clicked.
 *
 * It reads straight out of the run's views, which is the point: the same arrays
 * the trace renders, sliced to one actor. Before a run there is nothing to show
 * and it says so rather than inventing a plausible-looking sequence — a mock
 * here would teach the wrong thing about a screen whose whole claim is that the
 * numbers are real.
 */

import type { Views } from "../../api/contract";
import { useCopy } from "../../i18n/useCopy";
import { ROLE_COLOR, type Role } from "../../lib/roles";

const SHOWN = 12;

function Cell({ symbol, active, color }: { symbol: string; active: boolean; color: string }) {
  return (
    <span
      className="mono"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 19,
        height: 23,
        padding: "0 3px",
        borderRadius: 6,
        border: `1px solid ${active ? "var(--line-2)" : "var(--line)"}`,
        background: active ? "var(--panel-2)" : "transparent",
        color: active ? color : "var(--fg-3)",
        fontSize: 10.5,
      }}
    >
      {symbol}
    </span>
  );
}

export function Inspector({
  role,
  views,
  isBB84,
  onClose,
}: {
  role: Role;
  views: Views | null;
  isBB84: boolean;
  onClose: () => void;
}) {
  const t = useCopy();
  const color = ROLE_COLOR[role];

  const basis = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "·";
    if (!isBB84) return `${value}°`;
    return value ? "⤢" : "↕";
  };

  const rows: { key: string; cells: { symbol: string; active: boolean }[] }[] = [];
  if (views) {
    const kept = views.survived_sifting.slice(0, SHOWN);
    if (role === "eve" && views.eve) {
      rows.push({
        key: "views.eve.bases",
        cells: (views.eve.bases ?? []).slice(0, SHOWN).map((value) => ({
          symbol: basis(value),
          active: value !== null,
        })),
      });
    } else if (role === "source") {
      rows.push({
        key: "views.alice.angles",
        cells: (views.alice.angles ?? []).slice(0, SHOWN).map((value) => ({ symbol: `${value}°`, active: true })),
      });
      rows.push({
        key: "views.bob.angles",
        cells: (views.bob.angles ?? []).slice(0, SHOWN).map((value) => ({ symbol: `${value}°`, active: true })),
      });
    } else if (role === "alice" || role === "bob") {
      const view = views[role];
      const bases = (view.bases ?? view.angles ?? []).slice(0, SHOWN);
      const values = (view.bits ?? view.outcomes ?? []).slice(0, SHOWN);
      rows.push({
        key: `views.${role}.${view.bases ? "bases" : "angles"}`,
        cells: bases.map((value, index) => ({ symbol: basis(value), active: !!kept[index] })),
      });
      rows.push({
        key: `views.${role}.${view.bits ? "bits" : "outcomes"}`,
        cells: values.map((value, index) => ({ symbol: String(value), active: !!kept[index] })),
      });
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 18,
        right: 24,
        width: 310,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        zIndex: 5,
        boxShadow: "0 30px 70px -34px #000, inset 0 1px 0 var(--hi)",
        animation: "qrise .3s cubic-bezier(.32,.72,0,1) both",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "13px 15px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 8px -1px ${color}` }}
          />
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t.roles[role]}</span>
          <span
            className="mono"
            style={{
              padding: "2px 8px",
              borderRadius: 20,
              background: "var(--seg)",
              border: "1px solid var(--line)",
              color: "var(--fg-3)",
              fontSize: 9.5,
            }}
          >
            {t.roleTags[role]}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          style={{ border: "none", background: "transparent", color: "var(--fg-3)", cursor: "pointer", fontSize: 14 }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--fg-2)", lineHeight: 1.6 }}>{t.roleDesc[role]}</p>

        {rows.map((row) => (
          <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span className="mono" style={{ fontSize: 10, color: "var(--fg-3)" }}>
              {row.key}
            </span>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {row.cells.map((cell, index) => (
                <Cell key={index} symbol={cell.symbol} active={cell.active} color={color} />
              ))}
            </div>
          </div>
        ))}

        <span style={{ fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.5 }}>
          {role === "eve" ? t.legendEve : isBB84 ? t.legendBB84 : t.legendE91}
        </span>

      </div>
    </div>
  );
}
