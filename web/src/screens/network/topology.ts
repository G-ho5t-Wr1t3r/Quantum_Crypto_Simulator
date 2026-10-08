/**
 * How many relays each topology has, mirroring `chain()` and `fan()` in
 * `qkd/network.py`.
 *
 * Kept as named functions rather than inlined at each call site because the
 * bug this file exists to prevent was exactly a mismatch between the relay
 * count a screen assumed and the one the backend actually built: the fan has
 * `relays * paths` of them, not `relays`, and a shared bound computed from the
 * wrong one is accepted by the type checker and refused by the server.
 */

/** A chain has one relay per hop between the two endpoints. */
export function chainRelayCount(relays: number): number {
  return relays;
}

/** A fan names its relays per route, so paths multiply rather than share. */
export function fanRelayCount(relays: number, paths: number): number {
  return relays * paths;
}

/** How many relays the configured topology has, whichever one it is. */
export function relayCountFor(strategy: "relay_chain" | "split_paths", relays: number, paths: number): number {
  return strategy === "split_paths" ? fanRelayCount(relays, paths) : chainRelayCount(relays);
}

/**
 * The shared x-axis bound for comparing both strategies on one chart.
 *
 * It has to be valid on *both* networks at once, and the fan always has at
 * least as many relays as the chain (`paths` is at least 1). The chain's own
 * count is therefore always the tighter bound, and also the right question:
 * "at the same number of compromised relays" only has an answer up to the
 * smaller side.
 */
export function comparisonBound(relays: number): number {
  return chainRelayCount(relays);
}

export interface NetworkConfigShape {
  topology: "chain" | "fan";
  strategy: "relay_chain" | "split_paths";
  hop_length_km: number;
  relays: number;
  paths: number;
}

/**
 * The chain half of the comparison. Always one path — a chain *is* one route.
 */
export function chainNetworkConfig(relays: number, hopLengthKm: number): NetworkConfigShape {
  return { topology: "chain", strategy: "relay_chain", hop_length_km: hopLengthKm, relays, paths: 1 };
}

/**
 * The split half of the comparison. Always at least two paths — the backend
 * rejects a fan with one as "a chain under another name".
 *
 * `Math.max(paths, 2)` is what makes this independent of whatever `paths` the
 * run panel happened to hold, including 1: whoever calls this does not have
 * to know, or enforce, that a split needs at least two — this function cannot
 * be asked to produce a degenerate fan.
 */
export function splitNetworkConfig(relays: number, paths: number, hopLengthKm: number): NetworkConfigShape {
  return { topology: "fan", strategy: "split_paths", hop_length_km: hopLengthKm, relays, paths: Math.max(paths, 2) };
}
