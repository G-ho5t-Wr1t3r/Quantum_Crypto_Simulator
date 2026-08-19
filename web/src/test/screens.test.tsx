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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      nodes: [
        { id: "alice", label: "Alice", role: "sender", position: "endpoint" },
        { id: "bob", label: "Bob", role: "receiver", position: "endpoint" },
        { id: "eve", label: "Eve", role: "eavesdropper", position: "channel", optional: true },
      ],
      links: [
        { source: "alice", target: "bob", kind: "quantum", attackable: true },
        { source: "alice", target: "bob", kind: "classical", attackable: false },
      ],
    },
    e91: {
      nodes: [
        { id: "source", label: "Sorgente", role: "source", position: "endpoint" },
        { id: "alice", label: "Alice", role: "receiver", position: "endpoint" },
        { id: "bob", label: "Bob", role: "receiver", position: "endpoint" },
        { id: "eve", label: "Eve", role: "eavesdropper", position: "channel", optional: true },
      ],
      links: [
        { source: "source", target: "alice", kind: "quantum", attackable: true },
        { source: "source", target: "bob", kind: "quantum", attackable: false },
        { source: "alice", target: "bob", kind: "classical", attackable: false },
      ],
    },
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

  it("hides the position control, because there is nothing to choose", async () => {
    mount(<Configuration />, "/run");
    // Intercept-resend declares one valid position, so a switch would offer a
    // choice between one thing. Where she stands is in the diagram instead.
    await waitFor(() => expect(screen.getByText("Intercept-resend")).toBeDefined());
    expect(screen.queryByRole("radio", { name: "Canale" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Endpoint" })).toBeNull();
  });

  it("sets the channel once, and reads it out both ways", () => {
    mount(<Configuration />, "/run");
    // γ and a length are the same channel: one control, two readings.
    const slider = screen.getByLabelText("Attenuazione del canale");
    expect(slider).toBeDefined();
    expect(screen.getByText(/γ 0\.080 · 1\.8 km/)).toBeDefined();
    expect(screen.queryByText("per lunghezza")).toBeNull();
  });

  it("shows the run controls rather than a result before anything has run", () => {
    mount(<Configuration />, "/run");
    expect(screen.getByText("Esegui la simulazione")).toBeDefined();
    expect(screen.queryByText(/CHIAVE/)).toBeNull();
  });
});

describe("Configuration, per protocol", () => {
  it("does not offer a QBER threshold in E91, where it decides nothing", () => {
    mount(<Configuration />, "/run?protocol=e91");
    // The engine judges E91 on the Bell parameter alone: offering the error
    // threshold would be offering a control that is never consulted.
    expect(screen.queryByLabelText("Soglia QBER")).toBeNull();
    expect(screen.getByLabelText("Confidenza CHSH")).toBeDefined();
  });

  it("offers the QBER threshold in BB84, where it is the verdict", () => {
    mount(<Configuration />, "/run");
    expect(screen.getByLabelText("Soglia QBER")).toBeDefined();
    expect(screen.queryByLabelText("Confidenza CHSH")).toBeNull();
  });
});

describe("The network diagram", () => {
  it("depicts the run rather than offering a canvas", () => {
    mount(<Configuration />, "/run");
    // Nothing can be added, wired or moved: the picture is derived from the
    // protocol and the attack, so it cannot disagree with what will run.
    expect(screen.queryByText("+ Alice")).toBeNull();
    expect(screen.queryByText("Collega")).toBeNull();
    expect(screen.queryByText("Svuota")).toBeNull();
  });

  it("names both kinds of link, including the one nobody can attack", async () => {
    mount(<Configuration />, "/run");
    // The labels hang off the topology, so they appear once it has been fetched.
    await waitFor(() => expect(screen.getByText(/canale quantistico/)).toBeDefined());
    expect(screen.getByText(/canale classico/)).toBeDefined();
  });
});

describe("The results area before a result", () => {
  it("holds the space with the shape of what is coming", () => {
    mount(<Configuration />, "/run");
    // Not an empty half-screen: the layout that will be filled is already there,
    // so the arrival of data is a fill rather than a rebuild.
    expect(screen.getByText("IN ATTESA")).toBeDefined();
    expect(screen.getByText(/posizione per posizione/)).toBeDefined();
  });

  it("says the engine is working once a run starts", async () => {
    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Esegui la simulazione"));
    await waitFor(() => expect(screen.queryByText("IN ATTESA")).toBeNull());
  });
});

describe("A run, replayed", () => {
  it("shows the result section once the first trial lands", async () => {
    mount(<Configuration />, "/run");
    expect(screen.queryByText(/CHIAVE/)).toBeNull();

    fireEvent.click(screen.getByText("Esegui la simulazione"));

    // The verdict waits for the real aggregate; it is the one part of the
    // replay that reports something instead of illustrating it.
    await waitFor(() => expect(screen.getByText("CHIAVE ACCETTATA")).toBeDefined());
    expect(screen.getByText(/QBER = 0.0200/)).toBeDefined();
  });

  it("lays out the trace with one row per participant", async () => {
    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Esegui la simulazione"));
    await waitFor(() => expect(screen.getByText("Tracciato per posizione")).toBeDefined());
    // No Eve in the stubbed views, so no Eve row and no "intercepted" legend.
    expect(screen.queryByText("intercettata")).toBeNull();
  });
});

describe("Several repetitions", () => {
  /** The same run reported as three trials: only the first carries views. */
  const THREE = {
    ...RESULT,
    trials: [
      RESULT.trials[0],
      { ...RESULT.trials[0], qber: 0.05, views: null },
      { ...RESULT.trials[0], qber: 0.14, views: null },
    ],
    qber_mean: 0.07,
    qber_stdev: 0.06,
  };

  function stubThreeTrials() {
    class FakeSocket {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          const send = (payload: unknown) => this.onmessage?.({ data: JSON.stringify(payload) });
          send({ kind: "started", index: null, payload: { protocol: "bb84", trials: 3, n_qubits: 40 } });
          THREE.trials.forEach((trial, index) => send({ kind: "trial", index, payload: trial }));
          send({ kind: "done", index: null, payload: THREE });
          this.onclose?.();
        }, 0);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeSocket);
  }

  it("compares the outcomes instead of the positions", async () => {
    stubThreeTrials();
    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Esegui la simulazione"));

    // The views arrive with the first trial only — tens of thousands of values
    // per run — so with several repetitions there is nothing per-position to
    // compare, and the outcomes are the more useful comparison anyway.
    await waitFor(() => expect(screen.getByText("Confronto fra le ripetizioni")).toBeDefined());
    expect(screen.queryByText("Tracciato per posizione")).toBeNull();
    expect(screen.getByText("trial 3")).toBeDefined();
  });

  it("shows nothing at all until every repetition is in", async () => {
    stubThreeTrials();
    mount(<Configuration />, "/run");
    // Before the aggregate the panel used to appear on the first trial and then
    // rewrite itself under the reader's eyes as the mean arrived.
    expect(screen.getByText("IN ATTESA")).toBeDefined();
    expect(screen.queryByText(/CHIAVE/)).toBeNull();

    fireEvent.click(screen.getByText("Esegui la simulazione"));
    await waitFor(() => expect(screen.getByText("CHIAVE ACCETTATA")).toBeDefined());
  });
});

describe("Reaching a value exactly", () => {
  it("steps the channel by one increment at a time", () => {
    mount(<Configuration />, "/run");
    const slider = screen.getByLabelText("Attenuazione del canale") as HTMLInputElement;
    expect(slider.value).toBe("0.08");

    // A slider is good at "roughly here" and bad at "exactly this", and a value
    // that cannot be landed on is a run that cannot be repeated.
    fireEvent.click(screen.getByLabelText("Attenuazione del canale +"));
    expect(slider.value).toBe("0.085");

    fireEvent.click(screen.getByLabelText("Attenuazione del canale −"));
    expect(slider.value).toBe("0.08");
  });

  it("stops at the bound rather than stepping past it", () => {
    mount(<Configuration />, "/run");
    const trials = screen.getByLabelText("Ripetizioni") as HTMLInputElement;
    expect(trials.value).toBe("1");
    // One is the floor the backend declares, so the button is dead there.
    expect((screen.getByLabelText("Ripetizioni −") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Ripetizioni +"));
    expect(trials.value).toBe("2");
  });
});

describe("What the run is made of", () => {
  it("reports the key's composition in counts, not only as a ratio", async () => {
    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Esegui la simulazione"));
    await waitFor(() => expect(screen.getByText("Composizione della chiave")).toBeDefined());
    // Three kept-and-correct, one basis mismatch, in the stubbed views.
    expect(screen.getByText("3")).toBeDefined();
    // The limitation is stated where the number it qualifies is.
    expect(screen.getByText(/campione sacrificato/)).toBeDefined();
  });

  it("carries the reader down to it when the replay ends", async () => {
    // Asked for less movement, so the replay resolves at once and the scroll is
    // observable without waiting five seconds for a paced reveal.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    const { container } = mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Esegui la simulazione"));

    // It sits below the fold on most screens, and it is the panel that says
    // what the run produced — it was being missed entirely.
    const main = container.querySelector("main")!;
    await waitFor(() => expect(main.scrollTo).toHaveBeenCalled());
  });
});

describe("Reproducing a run", () => {
  it("copies the configuration without the clipboard API", async () => {
    // http at a LAN address has no secure context, so `navigator.clipboard` is
    // simply absent — which is how this gets demonstrated.
    vi.stubGlobal("isSecureContext", false);
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { writable: true, value: exec });

    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Copia configurazione"));

    await waitFor(() => expect(exec).toHaveBeenCalledWith("copy"));
    expect(screen.getByText("Copiata")).toBeDefined();
  });

  it("offers the text to select when nothing is allowed to copy", async () => {
    vi.stubGlobal("isSecureContext", false);
    Object.defineProperty(document, "execCommand", { writable: true, value: () => false });

    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Copia configurazione"));

    // A button that quietly does nothing is worse than one that says so.
    await waitFor(() => expect(screen.getByText(/pagina non protetta/)).toBeDefined());
    const area = screen.getByLabelText("Copia configurazione") as HTMLTextAreaElement;
    expect(JSON.parse(area.value).protocol).toBe("bb84");
  });


  it("adopts a pasted configuration", () => {
    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Carica una configurazione"));
    fireEvent.change(screen.getByLabelText("Carica una configurazione"), {
      target: { value: JSON.stringify({ protocol: "e91", seed: 4242, n_qubits: 800 }) },
    });
    fireEvent.click(screen.getByText("Applica"));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("E91");
    expect((screen.getByLabelText("Seed") as HTMLInputElement).value).toBe("4242");
  });

  it("refuses something that is not a configuration", () => {
    mount(<Configuration />, "/run");
    fireEvent.click(screen.getByText("Carica una configurazione"));
    fireEvent.change(screen.getByLabelText("Carica una configurazione"), {
      target: { value: "not json" },
    });
    fireEvent.click(screen.getByText("Applica"));
    expect(screen.getByText(/JSON non valido/)).toBeDefined();
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
  it("says out loud that it only applies to BB84", () => {
    mount(<Comparison />, "/compare");
    // The screen rests on the per-basis split, which E91 does not have. Someone
    // arriving from E91 has no other way to know.
    expect(screen.getByText("solo BB84")).toBeDefined();
  });

  it("runs both sides on arrival and reports them", async () => {
    mount(<Comparison />, "/compare");
    await waitFor(() => expect(screen.getAllByText("2.00 %").length).toBeGreaterThan(0));
    // Two panels, both fed by a real run rather than by a formula.
    expect(screen.getByText("LATO A")).toBeDefined();
    expect(screen.getByText("LATO B")).toBeDefined();
  });
});
