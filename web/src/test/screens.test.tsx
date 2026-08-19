/**
 * Render tests for the four screens.
 *
 * They are deliberately shallow on behaviour and strict on mounting: the point
 * is that every screen paints against a stubbed backend without throwing, which
 * is the failure a typechecker cannot catch and a reader meets immediately.
 *
 * The backend is stubbed rather than run, so nothing here checks physics. The
 * numbers are verified by the Python suite; what is verified here is that the
 * interface asks for the right things and survives what comes back — including
 * the nulls, which is the part most likely to break.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { AppearanceProvider } from "../app/appearance";
import Landing from "../screens/landing/Landing";
import Configuration from "../screens/configuration/Configuration";
import Exploration from "../screens/exploration/Exploration";
import Comparison from "../screens/comparison/Comparison";

const PLUGINS = {
  channels: ["amplitude_damping", "ideal"],
  attacks: { intercept_resend: ["channel"] },
  positions: ["channel", "endpoint"],
  topologies: {
    bb84: {
      nodes: [{ id: "alice", label: "Alice", role: "sender", position: "endpoint" }],
      links: [{ source: "alice", target: "bob", kind: "quantum", attackable: true }],
    },
    e91: { nodes: [], links: [] },
  },
};

/** A finished BB84 run, including the nulls the contract promises. */
const RESULT = {
  trials: [
    {
      qber: 0.02,
      sifting_ratio: 0.5,
      n_sifted: 10,
      chsh: null,
      chsh_sigma: null,
      qber_by_basis: { rectilinear: 0.03, diagonal: 0.01 },
      eavesdropper_knowledge: null,
      views: {
        alice: { bases: [0, 1, 0, 1], bits: [1, 0, 1, 0] },
        bob: { bases: [0, 1, 1, 1], outcomes: [1, 0, 0, 0] },
        survived_sifting: [true, true, false, true],
      },
    },
  ],
  qber_mean: 0.02,
  qber_stdev: 0.001,
  chsh_mean: null,
  chsh_stdev: null,
  accepted: true,
  reason: "QBER = 0.0200 against a threshold of 0.11",
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/plugins")
        ? PLUGINS
        : url.includes("/schema")
          ? { title: "SimulationConfig", properties: {} }
          : url.includes("/simulate") || url.includes("/sweep")
            ? { run_id: "test-run", status: "running" }
            : { run_id: "test-run", status: "completed", events: 3, result: RESULT, error: null };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

/**
 * A socket that delivers a whole run and closes, the way the real one does.
 *
 * Its behaviour is the contract's: replay from the beginning, then the terminal
 * event. A client that only worked against a live-from-now stream would break
 * on a page reload, which is precisely the case this shape covers.
 */
function stubWebSocket() {
  class FakeSocket {
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor() {
      setTimeout(() => {
        const send = (payload: unknown) => this.onmessage?.({ data: JSON.stringify(payload) });
        send({ kind: "started", index: null, payload: { protocol: "bb84", trials: 1, n_qubits: 40 } });
        send({ kind: "trial", index: 0, payload: RESULT.trials[0] });
        send({ kind: "done", index: null, payload: RESULT });
        this.onclose?.();
      }, 0);
    }

    close() {}
  }
  vi.stubGlobal("WebSocket", FakeSocket);
}

function mount(element: ReactElement, path = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppearanceProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="*" element={element} />
          </Routes>
        </MemoryRouter>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  stubFetch();
  stubWebSocket();
});

describe("Landing", () => {
  it("opens on the claim the whole page is making", () => {
    mount(<Landing />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("misura");
  });

  it("offers both protocols as a way in", () => {
    mount(<Landing />);
    // Both appear more than once — in the model cards and in the chooser.
    expect(screen.getAllByText("BB84").length).toBeGreaterThan(0);
    expect(screen.getAllByText("E91").length).toBeGreaterThan(0);
  });
});

describe("Configuration", () => {
  it("mounts with the protocol the landing page chose", () => {
    mount(<Configuration />, "/run?protocol=e91");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("E91");
  });

  it("offers only the positions the backend declares valid", async () => {
    mount(<Configuration />, "/run");
    // The default preset has an attacker, so the position switch is showing.
    await waitFor(() => expect(screen.getByRole("radio", { name: "Canale" })).toBeDefined());
    expect(screen.queryByRole("radio", { name: "Endpoint" })).toBeNull();
  });

  it("shows the run controls rather than a result before anything has run", () => {
    mount(<Configuration />, "/run");
    expect(screen.getByText("Esegui la simulazione")).toBeDefined();
    expect(screen.queryByText(/CHIAVE/)).toBeNull();
  });
});

describe("Exploration", () => {
  it("mounts with an axis selected and nothing swept yet", () => {
    mount(<Exploration />, "/explore");
    expect(screen.getByText("Modalità esplorazione")).toBeDefined();
    expect(screen.getByText("0 / 21")).toBeDefined();
  });

  it("names the closed set of axes, and the seed is not among them", () => {
    mount(<Exploration />, "/explore");
    for (const field of ["gamma", "length_km", "attack_fraction"]) {
      expect(screen.getAllByText(field).length).toBeGreaterThan(0);
    }
    // Sweeping the seed would draw a curve of pure noise that looks like a
    // result, so it must not be offerable at all.
    expect(screen.queryByText("seed")).toBeNull();
  });
});

describe("Comparison", () => {
  it("runs both sides on arrival and reports them", async () => {
    mount(<Comparison />, "/compare");
    await waitFor(() => expect(screen.getAllByText("2.00 %").length).toBeGreaterThan(0));
    // Two panels, both fed by a real run rather than by a formula.
    expect(screen.getByText("LATO A")).toBeDefined();
    expect(screen.getByText("LATO B")).toBeDefined();
  });
});
