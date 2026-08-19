/**
 * Where the participants stand, and what joins them.
 *
 * Pure layout, tested apart from the drawing: the bug this locks down was a
 * diagram that was topologically right and visually the opposite of the truth —
 * Eve placed in the middle of the frame ended up in the same column as the E91
 * source, and the picture then read as "Alice is wired to Eve, Bob to the
 * source". A diagram is believed, so the arithmetic behind it is worth a test.
 */

import { describe, expect, it } from "vitest";

import { place, route } from "../screens/configuration/NetworkDiagram";
import type { Topology } from "../api/contract";

const BB84: Topology = {
  nodes: [
    { id: "alice", label: "Alice", role: "sender", position: "endpoint" },
    { id: "bob", label: "Bob", role: "receiver", position: "endpoint" },
    { id: "eve", label: "Eve", role: "eavesdropper", position: "channel", optional: true },
  ],
  links: [
    { source: "alice", target: "bob", kind: "quantum", attackable: true },
    { source: "alice", target: "bob", kind: "classical", attackable: false },
  ],
};

const E91: Topology = {
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
};

const at = (topology: Topology, id: string) => place(topology, true).find((node) => node.id === id)!;

describe("Where Eve stands", () => {
  it("sits on the arm she breaks in E91, not in the middle of the picture", () => {
    const alice = at(E91, "alice");
    const source = at(E91, "source");
    const eve = at(E91, "eve");

    // Strictly between the two ends of the attackable link, which in E91 is
    // source→Alice — so she is never in the source's column.
    expect(eve.u).toBeGreaterThan(Math.min(alice.u, source.u));
    expect(eve.u).toBeLessThan(Math.max(alice.u, source.u));
    expect(eve.u).not.toBeCloseTo(source.u, 2);
  });

  it("sits between the two parties in BB84, where that is the attackable link", () => {
    const alice = at(BB84, "alice");
    const bob = at(BB84, "bob");
    const eve = at(BB84, "eve");
    expect(eve.u).toBeCloseTo((alice.u + bob.u) / 2, 5);
  });

  it("stands in front of the others, so nothing can hide her", () => {
    const eve = at(E91, "eve");
    for (const node of place(E91, true).filter((n) => n.id !== "eve")) {
      expect(eve.v).toBeGreaterThan(node.v);
    }
  });

  it("is absent entirely when nobody is attacking", () => {
    expect(place(E91, false).some((node) => node.id === "eve")).toBe(false);
    expect(route(E91, false)).toEqual(E91.links);
  });
});

describe("How the links are routed", () => {
  it("breaks the attackable link in two through Eve", () => {
    const links = route(E91, true);
    // An eavesdropper is a break in the line, not a node standing beside it.
    expect(links).toContainEqual({ source: "source", target: "eve", kind: "quantum", attackable: true });
    expect(links).toContainEqual({ source: "eve", target: "alice", kind: "quantum", attackable: true });
    expect(links).not.toContainEqual(E91.links[0]);
  });

  it("leaves every other link alone, including the one she cannot touch", () => {
    const links = route(E91, true);
    expect(links).toContainEqual({ source: "source", target: "bob", kind: "quantum", attackable: false });
    expect(links).toContainEqual({ source: "alice", target: "bob", kind: "classical", attackable: false });
  });

  it("keeps everyone at one depth so the chain reads as a line", () => {
    const row = place(E91, false).map((node) => node.v);
    expect(new Set(row).size).toBe(1);
  });
});
