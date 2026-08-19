/**
 * Who can stand in the network, and what colour says so.
 *
 * The colours are the semantic language declared in the token layer, not a
 * palette: blue is Alice, mint is Bob, red is Eve everywhere in the interface.
 */

export type Role = "alice" | "bob" | "eve" | "source" | "relay";

export const ROLE_COLOR: Record<Role, string> = {
  alice: "var(--blue)",
  bob: "var(--mint)",
  eve: "var(--red)",
  source: "var(--purple)",
  relay: "var(--grey)",
};

export const ROLE_GLYPH: Record<Role, string> = {
  alice: "A",
  bob: "B",
  eve: "E",
  source: "◇",
  relay: "R",
};

export const ALL_ROLES: Role[] = ["alice", "bob", "eve", "source", "relay"];
