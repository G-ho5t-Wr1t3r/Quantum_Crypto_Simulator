/**
 * @vitest-environment node
 *
 * No DOM needed, and deliberately not using the project's default jsdom
 * environment for this file: these are pure arithmetic checks.
 */

/**
 * The bug this file locks down: the comparison screen swept one strategy
 * using a bound computed from the *other* strategy's relay count. A fan with
 * `paths` routes has `relays * paths` relays, strictly more than the chain's
 * `relays` — so a bound taken from the fan asked the chain's own, smaller
 * network to compromise relays it did not have. The backend refused with
 * "cannot compromise N relays; this network has M", for every relay count,
 * because the mismatch was structural rather than a fluke of one value.
 *
 * These tests reproduce the backend's own rule — `compromised_count` must
 * never exceed `len(network.relays)` — against the counts this screen
 * assumes, across the relay and path combinations a reader can actually
 * dial in.
 */

import { describe, expect, it } from "vitest";

import {
  chainNetworkConfig,
  chainRelayCount,
  comparisonBound,
  fanRelayCount,
  relayCountFor,
  splitNetworkConfig,
} from "./topology";

const RELAYS = [0, 1, 2, 3, 6];
const PATHS = [2, 3, 4];

describe("relay counts match what the backend builds", () => {
  it("a chain has exactly `relays` relays", () => {
    for (const relays of RELAYS) {
      expect(chainRelayCount(relays)).toBe(relays);
    }
  });

  it("a fan has `relays * paths` relays, strictly more than a chain with the same `relays` once paths >= 2", () => {
    for (const relays of RELAYS) {
      for (const paths of PATHS) {
        expect(fanRelayCount(relays, paths)).toBe(relays * paths);
        if (relays > 0) {
          expect(fanRelayCount(relays, paths)).toBeGreaterThan(chainRelayCount(relays));
        }
      }
    }
  });

  it("relayCountFor picks the topology's own count, not the other one's", () => {
    for (const relays of RELAYS) {
      for (const paths of PATHS) {
        expect(relayCountFor("relay_chain", relays, paths)).toBe(relays);
        expect(relayCountFor("split_paths", relays, paths)).toBe(relays * paths);
      }
    }
  });
});

describe("the comparison sweep never asks a network to compromise more relays than it has", () => {
  it("comparisonBound is valid on the chain it is swept against", () => {
    for (const relays of RELAYS) {
      expect(comparisonBound(relays)).toBeLessThanOrEqual(chainRelayCount(relays));
    }
  });

  it("comparisonBound is also valid on the fan it is swept against, for every path count on offer", () => {
    for (const relays of RELAYS) {
      for (const paths of PATHS) {
        expect(comparisonBound(relays)).toBeLessThanOrEqual(fanRelayCount(relays, paths));
      }
    }
  });

  it("reproduces the exact failure this fix removes: the old bound exceeded the chain's own count", () => {
    for (const relays of RELAYS.filter((value) => value > 0)) {
      for (const paths of PATHS) {
        const oldBound = Math.max(relays, relays * Math.max(paths, 2));
        const chainHas = chainRelayCount(relays);
        // This is the defect: whatever `relays` was, the old bound was
        // `relays * paths` once `paths >= 2`, one or more past what the
        // chain actually has.
        expect(oldBound).toBeGreaterThan(chainHas);
        // And the replacement no longer is.
        expect(comparisonBound(relays)).toBeLessThanOrEqual(chainHas);
      }
    }
  });
});

/**
 * The second bug this screen hit: the comparison built its split config by
 * copying whichever config the run panel currently held and overriding only
 * `topology` and `strategy`. While the panel was in chain mode that base
 * already had `paths: 1` — chain forces it — so the derived "split" silently
 * stayed a fan with one path, which the backend refuses verbatim as "a fan
 * with one route is a chain under another name" (confirmed against the real
 * validator in `tests/test_network.py::test_fan_needs_at_least_two_paths`,
 * run under the project's own pytest suite: 321 passed).
 *
 * `chainNetworkConfig` and `splitNetworkConfig` close this off structurally:
 * neither is derived from the other or from any shared base, so there is no
 * value of `paths`, `strategy`, or prior UI state that can make one leak into
 * the other.
 */
describe("the two comparison configs cannot cross-contaminate", () => {
  it("the chain config is always exactly one path", () => {
    for (const relays of RELAYS) {
      expect(chainNetworkConfig(relays, 4).paths).toBe(1);
      expect(chainNetworkConfig(relays, 4).topology).toBe("chain");
    }
  });

  it("the split config is always at least two paths, even when asked for fewer", () => {
    for (const relays of RELAYS) {
      for (const requested of [0, 1, 2, 3, 4]) {
        const config = splitNetworkConfig(relays, requested, 4);
        expect(config.paths).toBeGreaterThanOrEqual(2);
        expect(config.topology).toBe("fan");
      }
    }
  });

  it("reproduces the exact failure this fix removes: deriving split from a chain-mode base left paths at 1", () => {
    for (const relays of RELAYS) {
      // What the old code did: take the panel's current config (here, chain
      // mode, so paths is forced to 1) and only patch topology/strategy.
      const chainModeBase = chainNetworkConfig(relays, 4);
      const oldDerivedSplit = { ...chainModeBase, topology: "fan" as const, strategy: "split_paths" as const };
      expect(oldDerivedSplit.paths).toBe(1); // the defect: a fan that is actually a chain

      // What the fix does instead: build the split independently.
      const fixedSplit = splitNetworkConfig(relays, 2, 4);
      expect(fixedSplit.paths).toBeGreaterThanOrEqual(2);
    }
  });
});
