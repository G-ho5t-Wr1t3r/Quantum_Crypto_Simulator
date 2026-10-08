"""Multi-hop key distribution: how a key crosses a distance one hop cannot.

WHAT THIS MODULE IS FOR
=======================
The point-to-point simulator makes a claim and demonstrates it: past a certain
length the error rate climbs over the threshold and the key is discarded. The
adversary is one enemy of the protocol, and distance is the other.

This module is the answer to that, and it is a networking answer rather than a
physical one. Nothing here improves a channel. The route is cut into hops short
enough that each one comfortably produces a key, and the key is carried across
the junctions between them — which is precisely where the cost appears, because
a junction is a node that holds key material it is not the recipient of.

Two ways of paying that cost are implemented, so that they can be compared
rather than asserted:

    RELAY_CHAIN     the whole key, forwarded hop by hop. Established practice.
                    Every relay holds all of it. One compromised relay is the
                    whole key.

    SPLIT_PATHS     the key, split across routes that share no intermediate
                    node. No relay holds more than a fragment, and a fragment
                    on its own is independent of the key. The adversary needs
                    every route, not any route.

DESIGN DECISION — the protocol code is not touched
===================================================
A hop is an ordinary `SimulationConfig` run by the ordinary engine. This module
builds those configurations, runs them, and composes their results; it contains
no quantum mechanics and imports neither bb84 nor e91.

That is a deliberate boundary and it is what keeps the extension honest. The
numbers that matter here — does a hop produce a key, how much, at what error
rate — come from the same simulation that produced the point-to-point results,
so a multi-hop figure and a single-hop figure are comparable by construction
rather than by assertion. It also means a hop inherits every property the engine
already guarantees, reproducibility included, without this module restating any
of it.

DECLARED LIMITATION — key length is simulated, key material is drawn
=====================================================================
The engine reports how long a hop's sifted key is, not what its bits are: a run
result carries `n_sifted`, not the key. So the relaying implemented here uses
key material of the simulated LENGTH with bit values drawn from the run's seeded
generator.

This is stated rather than hidden because of what it does and does not affect.
The quantities under study — how much key survives the route, whether it
survives at all, how much of it the adversary learns — depend on the lengths and
on who holds which fragment, and those are simulated. What the bits happen to be
does not enter any of them. What the drawn material does buy is that the
relaying and the splitting are performed on real bits rather than described, so
the reconstruction is exercised on every run and a mistake in it fails loudly
instead of being assumed away.

DECLARED LIMITATION — routes are built, not discovered
=======================================================
The topologies here are constructed from a configuration: a chain of a given
length, or a fan of a given width. There is no graph of an arbitrary network and
no routing algorithm that searches it for disjoint paths.

The reason is that the claim being demonstrated does not need one. Whether
splitting a key across disjoint routes defeats a partial compromise is a
property of the routes being disjoint, not of how they were found. Finding them
in an arbitrary topology is a well-defined and well-studied problem — it is the
resource-assignment problem the optical-network literature treats as NP-hard and
attacks with heuristics — and it is a different piece of work from the one this
module does. What is enforced is the property the strategy actually depends on:
`Network.disjoint_relays` is checked before a split runs, so a route set that
shares a relay is refused rather than silently reported as a split.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from enum import Enum

import numpy as np

from qkd.actors import Position
from qkd.attacks import CompromisedRelay, validate_placement
from qkd.engine import EventKind, RunResult, SimulationEvent
from qkd.engine import run as engine_run
from qkd.metrics import key_leakage, surviving_key_bits
from qkd.settings import (
    ChannelConfig,
    ChannelKind,
    NetworkConfig,
    NetworkSimulationConfig,
    SimulationConfig,
    StrategyKind,
    TopologyKind,
)
from qkd.types import Bits

SOURCE = "alice"
TARGET = "bob"


# ---------------------------------------------------------------------------
# The route
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Hop:
    """One point-to-point link, between two adjacent nodes.

    The unit the protocol actually runs on. Its length is the only physical
    quantity in the whole route description, because it is the only one the
    channel responds to.
    """

    source: str
    target: str
    length_km: float

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "length_km": self.length_km,
        }


@dataclass(frozen=True)
class Route:
    """A sequence of hops from the source to the target.

    Holds its hops rather than its nodes, because a route is defined by the
    links it uses: two routes through the same nodes in a different order are
    different routes, and the nodes alone would not say so.
    """

    hops: tuple[Hop, ...]

    def __post_init__(self) -> None:
        if not self.hops:
            raise ValueError("a route has at least one hop")
        for before, after in zip(self.hops, self.hops[1:]):
            if before.target != after.source:
                raise ValueError(
                    f"route is not connected: a hop ends at {before.target} "
                    f"and the next begins at {after.source}"
                )

    @property
    def nodes(self) -> tuple[str, ...]:
        """Every node on the route, source and target included."""
        return (self.hops[0].source,) + tuple(hop.target for hop in self.hops)

    @property
    def relays(self) -> tuple[str, ...]:
        """The intermediate nodes: the ones that are trusted rather than party.

        Excludes both ends. The endpoints are supposed to know the key; the
        relays are not, and the whole threat model of this module is about them.
        """
        return self.nodes[1:-1]

    @property
    def length_km(self) -> float:
        return sum(hop.length_km for hop in self.hops)


@dataclass(frozen=True)
class Network:
    """A set of routes between one source and one target.

    Deliberately not a general graph. It carries what the strategies need to be
    stated and checked, which is the routes and whether they overlap, and
    nothing it would not use.
    """

    source: str
    target: str
    routes: tuple[Route, ...]

    def __post_init__(self) -> None:
        if not self.routes:
            raise ValueError("a network has at least one route")
        for route in self.routes:
            if route.nodes[0] != self.source or route.nodes[-1] != self.target:
                raise ValueError(
                    f"every route must run from {self.source} to {self.target}; "
                    f"found one from {route.nodes[0]} to {route.nodes[-1]}"
                )

    @property
    def relays(self) -> tuple[str, ...]:
        """Every intermediate node in the network, in route order, deduplicated."""
        seen: dict[str, None] = {}
        for route in self.routes:
            for relay in route.relays:
                seen[relay] = None
        return tuple(seen)

    @property
    def disjoint_relays(self) -> bool:
        """Whether no intermediate node is shared by two routes.

        The property the split strategy depends on, and the reason it is a
        method here rather than an assumption in the strategy: a shared relay
        would see two fragments, and the guarantee that a single compromise
        yields nothing would quietly stop holding while the run still reported
        itself as a split.
        """
        total = sum(len(route.relays) for route in self.routes)
        return total == len(self.relays)

    def routes_through(self, relay: str) -> tuple[int, ...]:
        """Indices of the routes passing through `relay`."""
        return tuple(
            index for index, route in enumerate(self.routes) if relay in route.relays
        )

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "relays": list(self.relays),
            "disjoint_relays": self.disjoint_relays,
            "routes": [
                {
                    "nodes": list(route.nodes),
                    "relays": list(route.relays),
                    "length_km": route.length_km,
                    "hops": [hop.as_dict() for hop in route.hops],
                }
                for route in self.routes
            ],
        }


def chain(relays: int, hop_length_km: float) -> Network:
    """A single route: source, a line of relays, target.

    The reference case. With no relays it is one hop, which is the
    point-to-point run the rest of the simulator already does — kept legal on
    purpose, so that the baseline of every comparison is reachable from the same
    configuration rather than from a different code path.
    """
    nodes = [SOURCE] + [f"r{i + 1}" for i in range(relays)] + [TARGET]
    hops = tuple(
        Hop(source=a, target=b, length_km=hop_length_km)
        for a, b in zip(nodes, nodes[1:])
    )
    return Network(source=SOURCE, target=TARGET, routes=(Route(hops=hops),))


def fan(paths: int, relays: int, hop_length_km: float) -> Network:
    """Parallel routes of equal length, sharing only their two endpoints.

    The source negotiates with one neighbour per route and each neighbour
    forwards along a line of its own. Equal lengths are a simplification and a
    deliberate one: unequal routes would make the slowest one the bottleneck and
    mix a question about routing into a comparison about security.

    Relays are named per route, so no two routes can accidentally refer to the
    same node — the disjointness the split depends on is a property of the
    construction here, and checked again before it is relied upon.
    """
    if paths < 2:
        raise ValueError(
            f"a fan has at least two routes, got {paths}; one route is a chain"
        )
    routes = []
    for path in range(paths):
        nodes = (
            [SOURCE] + [f"p{path + 1}r{i + 1}" for i in range(relays)] + [TARGET]
        )
        hops = tuple(
            Hop(source=a, target=b, length_km=hop_length_km)
            for a, b in zip(nodes, nodes[1:])
        )
        routes.append(Route(hops=hops))
    return Network(source=SOURCE, target=TARGET, routes=tuple(routes))


_TOPOLOGIES = {
    TopologyKind.CHAIN: lambda config: chain(config.relays, config.hop_length_km),
    TopologyKind.FAN: lambda config: fan(
        config.paths, config.relays, config.hop_length_km
    ),
}


def build_network(config: NetworkConfig) -> Network:
    """Construct the route set a configuration describes."""
    return _TOPOLOGIES[config.topology](config)


# ---------------------------------------------------------------------------
# Key material
# ---------------------------------------------------------------------------


def split_key(key: Bits, fragments: int, rng: np.random.Generator) -> list[Bits]:
    """Split a key into fragments that are worthless apart and exact together.

    Every fragment but the last is uniform random; the last is the key combined
    with all the others under exclusive or. Any proper subset is then a set of
    independent uniform bits carrying nothing about the key, while the complete
    set reconstructs it exactly.

    This is the all-or-nothing case on purpose. It maximises secrecy and
    minimises availability — losing one fragment loses the key — and that
    trade-off is half of what the comparison is meant to show.

    Args:
        key: the secret to split.
        fragments: how many pieces to produce, at least one.
        rng: seeded generator; the split is part of the run and reproducible.

    Returns:
        `fragments` lists of bits, each as long as the key.

    Raises:
        ValueError: if fewer than one fragment is asked for.
    """
    if fragments < 1:
        raise ValueError(f"a key splits into at least one fragment, got {fragments}")
    if fragments == 1:
        return [list(key)]

    pads = [
        [int(bit) for bit in rng.integers(0, 2, size=len(key))]
        for _ in range(fragments - 1)
    ]
    last = list(key)
    for pad in pads:
        last = [a ^ b for a, b in zip(last, pad)]
    return pads + [last]


def combine_key(fragments: Sequence[Bits]) -> Bits:
    """Reconstruct a key from the complete set of its fragments.

    Raises:
        ValueError: if no fragments are given, or they are not all the same
            length — which would mean one of them was truncated in transit, and
            silently reconstructing a shorter key would hide that.
    """
    if not fragments:
        raise ValueError("nothing to combine")
    lengths = {len(fragment) for fragment in fragments}
    if len(lengths) != 1:
        raise ValueError(
            f"fragments have different lengths {sorted(lengths)}; "
            "one of them did not survive the route intact"
        )

    combined = list(fragments[0])
    for fragment in fragments[1:]:
        combined = [a ^ b for a, b in zip(combined, fragment)]
    return combined


def relay_bits(payload: Bits, hop_keys: Sequence[Bits]) -> Bits:
    """Carry a payload along a route, re-encrypting it on every hop.

    What a trusted relay physically does: the payload arrives encrypted under
    the previous hop's key, is decrypted, and is re-encrypted under the next
    one. Each step is a one-time pad with the key that hop established.

    Modelled as the composition of those pads, which returns the payload
    unchanged — and that is the result, not a shortcut. The payload is recovered
    intact at the far end, and it was in the clear at every junction in between.
    The function exists to make both halves of that explicit, and to fail if a
    hop key is too short to cover the payload it is supposed to protect.

    Raises:
        ValueError: if any hop key is shorter than the payload. A pad reused or
            stretched to cover more than its own length is not a one-time pad,
            and producing a key anyway would be the one failure here that does
            not look like one.
    """
    for index, hop_key in enumerate(hop_keys):
        if len(hop_key) < len(payload):
            raise ValueError(
                f"hop {index} established {len(hop_key)} bits, too few to carry "
                f"a payload of {len(payload)}; the route cannot forward more key "
                "than its weakest hop produced"
            )

    carried = list(payload)
    for hop_key in hop_keys:
        pad = hop_key[: len(carried)]
        carried = [a ^ b for a, b in zip(carried, pad)]
        carried = [a ^ b for a, b in zip(carried, pad)]
    return carried


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class HopOutcome:
    """What one hop produced.

    `accepted` is the engine's verdict under the configured policy, not a
    judgement made here: a hop whose error rate cleared the threshold delivers
    key, and one that did not delivers nothing.
    """

    source: str
    target: str
    length_km: float
    qber: float
    accepted: bool
    bits: int
    reason: str

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "length_km": self.length_km,
            "qber": self.qber,
            "accepted": self.accepted,
            "bits": self.bits,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class RouteOutcome:
    """What one route delivered, and who along it was listening."""

    nodes: tuple[str, ...]
    relays: tuple[str, ...]
    hops: tuple[HopOutcome, ...]
    length_km: float
    delivered: bool
    bits: int
    compromised_relays: tuple[str, ...]

    @property
    def observed(self) -> bool:
        """Whether the adversary holds at least one relay on this route.

        One is enough. A relay sees everything that crosses it, so a route is
        either clean or entirely readable, with nothing in between — which is
        why this is a predicate and not a count.
        """
        return bool(self.compromised_relays)

    def as_dict(self) -> dict:
        return {
            "nodes": list(self.nodes),
            "relays": list(self.relays),
            "hops": [hop.as_dict() for hop in self.hops],
            "length_km": self.length_km,
            "delivered": self.delivered,
            "bits": self.bits,
            "compromised_relays": list(self.compromised_relays),
            "observed": self.observed,
        }


@dataclass(frozen=True)
class NetworkResult:
    """The outcome of one multi-hop run.

    The three numbers the comparison turns on are `key_bits`, `delivered` and
    `leaked_fraction`: how much key reached the far end, whether any did, and
    how much of it the adversary can reconstruct. Reported next to
    `worst_hop_qber` so that a failure can always be attributed — a route that
    delivered nothing because of distance looks nothing like one that delivered
    nothing because a fragment was lost, and the two must not be confused on a
    plot.
    """

    strategy: StrategyKind
    topology: TopologyKind
    network: Network
    total_length_km: float
    hop_length_km: float
    hops_per_route: int
    routes: tuple[RouteOutcome, ...]
    key_bits: int
    delivered: bool
    leaked_fraction: float
    fragments: int
    threshold: int
    worst_hop_qber: float
    reason: str

    def as_dict(self) -> dict:
        return {
            "strategy": self.strategy.value,
            "topology": self.topology.value,
            "network": self.network.as_dict(),
            "total_length_km": self.total_length_km,
            "hop_length_km": self.hop_length_km,
            "hops_per_route": self.hops_per_route,
            "routes": [route.as_dict() for route in self.routes],
            "key_bits": self.key_bits,
            "delivered": self.delivered,
            "leaked_fraction": self.leaked_fraction,
            "fragments": self.fragments,
            "threshold": self.threshold,
            "worst_hop_qber": self.worst_hop_qber,
            "reason": self.reason,
        }


# ---------------------------------------------------------------------------
# Running a route
# ---------------------------------------------------------------------------


def hop_config(config: NetworkSimulationConfig, hop: Hop, seed: int) -> SimulationConfig:
    """Derive the point-to-point configuration of a single hop.

    The channel is not copied from anywhere: it is the hop's length under the
    damping model, which is what makes the hop length the one physical knob in a
    route. An ideal channel is not offered here, because a multi-hop run whose
    hops were lossless would be a route built to defeat a problem it had been
    configured not to have.
    """
    return SimulationConfig(
        protocol=config.protocol,
        n_qubits=config.n_qubits,
        trials=config.trials,
        seed=seed,
        channel=ChannelConfig(
            kind=ChannelKind.AMPLITUDE_DAMPING, length_km=hop.length_km
        ),
        attack=config.attack,
        security=config.security,
    )


def _hop_bits(result: RunResult) -> int:
    """Usable key length a hop established, averaged over its trials.

    Zero when the policy rejected the run: a discarded key is not a short key,
    it is no key, and carrying its length forward would let a route deliver
    material that the protocol refused to certify.
    """
    if not result.accepted:
        return 0
    return int(statistics.fmean(trial.n_sifted for trial in result.trials))


def _run_route(
    config: NetworkSimulationConfig, route: Route, route_index: int
) -> tuple[list[HopOutcome], list[Bits], np.random.Generator]:
    """Run every hop of a route, returning the outcomes and their key material.

    Each hop is seeded from the run seed, the route index and its own position,
    so hops are independent of one another while the run stays reproducible.
    Reusing one seed across hops would make every hop of a route produce the
    same errors and turn a route's spread into exactly zero.
    """
    outcomes: list[HopOutcome] = []
    hop_keys: list[Bits] = []

    for position, hop in enumerate(route.hops):
        seed = config.seed + 1000 * (route_index + 1) + position
        result = engine_run(hop_config(config, hop, seed))
        bits = _hop_bits(result)
        outcomes.append(
            HopOutcome(
                source=hop.source,
                target=hop.target,
                length_km=hop.length_km,
                qber=result.qber_mean,
                accepted=result.accepted,
                bits=bits,
                reason=result.reason,
            )
        )
        rng = np.random.default_rng(seed)
        hop_keys.append([int(bit) for bit in rng.integers(0, 2, size=bits)])

    return outcomes, hop_keys, np.random.default_rng(config.seed + route_index)


# ---------------------------------------------------------------------------
# The compromise
# ---------------------------------------------------------------------------


def validate_compromise(network: Network, compromised: Sequence[str]) -> None:
    """Refuse a compromise that names something that is not a relay.

    Routed through the same `validate_placement` as every other attack, with a
    relay actor standing at each named node. Naming an endpoint is the case it
    catches: an adversary at Alice or Bob is an insider, not a relay problem,
    and treating it as one would report a key as leaked by the route when the
    route had nothing to do with it.

    Raises:
        ValueError: if a named node is not on any route.
        AttackNotAllowedError: if a named node is an endpoint rather than a relay.
    """
    relays = set(network.relays)
    endpoints = {network.source, network.target}
    attack = CompromisedRelay()

    for node in compromised:
        if node in endpoints:
            validate_placement(attack, Position.ENDPOINT)
        if node not in relays:
            raise ValueError(
                f"{node} is not a relay on this network; "
                f"its relays are {', '.join(relays) or '(none)'}"
            )
        validate_placement(attack, Position.RELAY)


def draw_compromise(
    network: Network, count: int, rng: np.random.Generator
) -> tuple[str, ...]:
    """Pick `count` relays at random, without replacement.

    Random rather than adversarial on purpose. An optimal adversary would spend
    its budget covering one relay per route, which is the worst case and worth
    plotting separately; drawing uniformly answers the different and more
    reportable question of what a compromise of a given size costs on average.

    Raises:
        ValueError: if more relays are asked for than the network has.
    """
    relays = network.relays
    if count > len(relays):
        raise ValueError(
            f"cannot compromise {count} relays; the network has {len(relays)}"
        )
    if count == 0:
        return ()
    chosen = rng.choice(len(relays), size=count, replace=False)
    return tuple(relays[int(index)] for index in sorted(chosen))


def _leakage(
    network: Network,
    config: NetworkConfig,
    delivered_routes: Sequence[int],
    rng: np.random.Generator,
) -> tuple[float, tuple[str, ...]]:
    """How much key the adversary reconstructs, averaged over the compromises.

    DESIGN DECISION — the quantum part runs once, the compromise many times
    ------------------------------------------------------------------------
    Which relays are compromised changes nothing about the physics: the hops
    produce the same keys either way, because a compromised relay reads what it
    is given and disturbs nothing. So the expensive half of the run is performed
    once and the cheap half is averaged over as many draws as asked for.

    That is what makes the leakage curve affordable. A smooth curve against the
    size of the compromise needs many draws per point, and re-running the hops
    for each would multiply the cost of a plot by a hundred for numbers that
    would come out identical.

    Returns:
        The mean leaked fraction, and the compromise of the last draw — kept so
        that a named scenario, which is the single-draw case, can be reported
        back as the one that was actually evaluated.
    """
    if config.compromised is not None:
        draws = [tuple(config.compromised)]
    elif config.compromised_count is not None:
        draws = [
            draw_compromise(network, config.compromised_count, rng)
            for _ in range(config.attack_draws)
        ]
    else:
        draws = [()]

    threshold = config.effective_threshold
    fragments = len(network.routes) if config.strategy is StrategyKind.SPLIT_PATHS else 1

    leaks = []
    for draw in draws:
        if config.strategy is StrategyKind.SPLIT_PATHS:
            observed = {
                index
                for relay in draw
                for index in network.routes_through(relay)
            }
            leaks.append(key_leakage(len(observed), fragments, threshold))
        else:
            # The chain carries one fragment, the key itself, along the route it
            # used. Any relay on that route is enough.
            carried = delivered_routes[0] if delivered_routes else 0
            on_route = any(
                relay in network.routes[carried].relays for relay in draw
            )
            leaks.append(key_leakage(1 if on_route else 0, 1, 1))

    return statistics.fmean(leaks), draws[-1]


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


def _relay_chain(
    config: NetworkSimulationConfig, network: Network
) -> tuple[list[RouteOutcome], int, bool, str, list[int]]:
    """Forward the whole key along a single route.

    On a fan the first route is used and the others are left idle. That is not a
    limitation being worked around but the comparison being set up: the chain
    strategy is what the same network does without splitting, so running it over
    the same topology is what makes the two curves answer the same question.
    """
    route = network.routes[0]
    outcomes, hop_keys, rng = _run_route(config, route, 0)

    bits = surviving_key_bits([hop.bits for hop in outcomes])
    delivered = all(hop.accepted for hop in outcomes) and bits > 0

    if delivered:
        key = [int(bit) for bit in rng.integers(0, 2, size=bits)]
        carried = relay_bits(key, [hop_key[:bits] for hop_key in hop_keys])
        if carried != key:
            raise AssertionError(
                "a relayed key did not arrive intact; the hop pads do not compose"
            )

    failed = [hop for hop in outcomes if not hop.accepted]
    reason = (
        f"{len(failed)} of {len(outcomes)} hops discarded their key"
        if failed
        else f"{bits} bits relayed across {len(outcomes)} hops"
    )

    return (
        [
            RouteOutcome(
                nodes=route.nodes,
                relays=route.relays,
                hops=tuple(outcomes),
                length_km=route.length_km,
                delivered=delivered,
                bits=bits,
                compromised_relays=(),
            )
        ],
        bits,
        delivered,
        reason,
        [0],
    )


def _split_paths(
    config: NetworkSimulationConfig, network: Network
) -> tuple[list[RouteOutcome], int, bool, str, list[int]]:
    """Split the key across the routes, one fragment each.

    WHY DELIVERY IS HARDER HERE, AND WHY THAT IS REPORTED
    ------------------------------------------------------
    Every fragment is required, so the route set delivers only if every route
    delivers. Availability therefore gets worse exactly as secrecy gets better,
    and both halves are measured: a run where one route failed reports no key
    and says which route, rather than quietly reporting a shorter one.

    The key is as long as the shortest route can carry, since the fragments must
    all be the same length — the minimum over routes of the minimum over their
    hops. Two nested bottlenecks, and both are genuine.
    """
    if not network.disjoint_relays:
        raise ValueError(
            "the routes share a relay, so splitting across them would hand "
            "two fragments to one node; the split guarantee does not hold"
        )

    per_route: list[tuple[Route, list[HopOutcome], list[Bits]]] = []
    rng = np.random.default_rng(config.seed)
    for index, route in enumerate(network.routes):
        outcomes, hop_keys, _ = _run_route(config, route, index)
        per_route.append((route, outcomes, hop_keys))

    route_bits = [
        surviving_key_bits([hop.bits for hop in outcomes])
        for _, outcomes, _ in per_route
    ]
    route_delivered = [
        all(hop.accepted for hop in outcomes) and bits > 0
        for (_, outcomes, _), bits in zip(per_route, route_bits)
    ]

    delivered = all(route_delivered)
    bits = min(route_bits) if delivered else 0

    if delivered:
        key = [int(bit) for bit in rng.integers(0, 2, size=bits)]
        fragments = split_key(key, len(network.routes), rng)
        arrived = [
            relay_bits(fragment, [hop_key[:bits] for hop_key in hop_keys])
            for fragment, (_, _, hop_keys) in zip(fragments, per_route)
        ]
        if combine_key(arrived) != key:
            raise AssertionError(
                "the fragments did not recombine into the key; "
                "the split and the relaying disagree"
            )

    lost = [index for index, ok in enumerate(route_delivered) if not ok]
    reason = (
        f"{bits} bits recombined from {len(network.routes)} fragments"
        if delivered
        else f"routes {lost} delivered no fragment, so the key cannot be recombined"
    )

    return (
        [
            RouteOutcome(
                nodes=route.nodes,
                relays=route.relays,
                hops=tuple(outcomes),
                length_km=route.length_km,
                delivered=ok,
                bits=route_bit,
                compromised_relays=(),
            )
            for (route, outcomes, _), ok, route_bit in zip(
                per_route, route_delivered, route_bits
            )
        ],
        bits,
        delivered,
        reason,
        [index for index, ok in enumerate(route_delivered) if ok],
    )


_STRATEGIES = {
    StrategyKind.RELAY_CHAIN: _relay_chain,
    StrategyKind.SPLIT_PATHS: _split_paths,
}


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def run(config: NetworkSimulationConfig) -> NetworkResult:
    """Execute a multi-hop configuration and return its outcome.

    Raises:
        ValueError: if the compromise names a node that is not a relay, or the
            strategy cannot be applied to the topology.
        AttackNotAllowedError: if the compromise names an endpoint.
    """
    network = build_network(config.network)

    if config.network.compromised is not None:
        validate_compromise(network, config.network.compromised)
    if config.network.compromised_count is not None and config.network.compromised_count > len(
        network.relays
    ):
        raise ValueError(
            f"cannot compromise {config.network.compromised_count} relays; "
            f"this network has {len(network.relays)}"
        )

    routes, bits, delivered, reason, carried = _STRATEGIES[config.network.strategy](
        config, network
    )

    leaked, draw = _leakage(
        network, config.network, carried, np.random.default_rng(config.seed + 7919)
    )
    routes = [
        RouteOutcome(
            nodes=route.nodes,
            relays=route.relays,
            hops=route.hops,
            length_km=route.length_km,
            delivered=route.delivered,
            bits=route.bits,
            compromised_relays=tuple(r for r in draw if r in route.relays),
        )
        for route in routes
    ]

    every_hop = [hop for route in routes for hop in route.hops]
    fragments = (
        len(network.routes)
        if config.network.strategy is StrategyKind.SPLIT_PATHS
        else 1
    )

    return NetworkResult(
        strategy=config.network.strategy,
        topology=config.network.topology,
        network=network,
        total_length_km=config.network.total_length_km,
        hop_length_km=config.network.hop_length_km,
        hops_per_route=config.network.hops_per_path,
        routes=tuple(routes),
        key_bits=bits,
        delivered=delivered,
        leaked_fraction=leaked,
        fragments=fragments,
        threshold=config.network.effective_threshold,
        worst_hop_qber=max((hop.qber for hop in every_hop), default=0.0),
        reason=reason,
    )


def stream(config: NetworkSimulationConfig) -> Iterator[SimulationEvent]:
    """Execute the configuration, reporting the route before running it.

    The started event carries the whole route set, so an interface can draw the
    network before the first hop has been simulated — a multi-hop run takes as
    long as all its hops put together, and a client that had to wait for the
    result to learn the shape of what it was waiting for would show nothing for
    the duration.

    The route is also validated before anything runs, for the same reason the
    point-to-point engine validates placement up front: an impossible
    configuration must be refused rather than reported after the computation.
    """
    network = build_network(config.network)
    if config.network.compromised is not None:
        validate_compromise(network, config.network.compromised)
    if config.network.strategy is StrategyKind.SPLIT_PATHS and not network.disjoint_relays:
        raise ValueError(
            "the routes share a relay, so splitting across them would hand "
            "two fragments to one node; the split guarantee does not hold"
        )

    yield SimulationEvent(
        kind=EventKind.STARTED,
        payload={
            "protocol": config.protocol.value,
            "strategy": config.network.strategy.value,
            "topology": config.network.topology.value,
            "network": network.as_dict(),
            "hop_length_km": config.network.hop_length_km,
            "total_length_km": config.network.total_length_km,
            "hops_per_route": config.network.hops_per_path,
            "n_qubits": config.n_qubits,
            "trials": config.trials,
        },
    )

    result = run(config)
    for index, route in enumerate(result.routes):
        yield SimulationEvent(
            kind=EventKind.TRIAL, index=index, payload=route.as_dict()
        )
    yield SimulationEvent(kind=EventKind.DONE, payload=result.as_dict())


class NetworkSweepAxis(str, Enum):
    """Which property of the route a sweep varies.

    A closed set for the same reason the point-to-point axes are closed, with
    one addition that matters: COMPROMISED is the axis the whole comparison
    exists for. Everything else moves distance around; that one moves the
    adversary, and it is where the two strategies stop agreeing.
    """

    HOP_LENGTH_KM = "hop_length_km"
    RELAYS = "relays"
    PATHS = "paths"
    COMPROMISED = "compromised"


_INTEGER_AXES = {
    NetworkSweepAxis.RELAYS,
    NetworkSweepAxis.PATHS,
    NetworkSweepAxis.COMPROMISED,
}


def _with_axis(
    config: NetworkSimulationConfig, axis: NetworkSweepAxis, value: float
) -> NetworkSimulationConfig:
    """A copy of the configuration with one axis set to `value`.

    Rebuilt through the model rather than mutated, so every sweep point is
    validated on its own: a point that asks for a split across one route, or for
    more compromised relays than the route has, is refused where it occurs
    instead of producing a number.
    """
    network = config.network.model_dump()
    if axis in _INTEGER_AXES:
        value = int(round(value))

    if axis is NetworkSweepAxis.COMPROMISED:
        network["compromised"] = None
        network["compromised_count"] = int(value)
    else:
        network[axis.value] = value

    return config.model_copy(update={"network": NetworkConfig(**network)})


def sweep_stream(
    config: NetworkSimulationConfig,
    axis: NetworkSweepAxis,
    values: Sequence[float],
) -> Iterator[SimulationEvent]:
    """Run the configuration once per value, yielding a point each time."""
    yield SimulationEvent(
        kind=EventKind.STARTED,
        payload={
            "axis": axis.value,
            "values": list(values),
            "strategy": config.network.strategy.value,
            "topology": config.network.topology.value,
        },
    )

    points = []
    for index, value in enumerate(values):
        result = run(_with_axis(config, axis, value))
        point = {
            "value": value,
            "key_bits": result.key_bits,
            "delivered": result.delivered,
            "leaked_fraction": result.leaked_fraction,
            "worst_hop_qber": result.worst_hop_qber,
            "total_length_km": result.total_length_km,
        }
        points.append(point)
        yield SimulationEvent(
            kind=EventKind.SWEEP_POINT, index=index, payload=point
        )

    yield SimulationEvent(
        kind=EventKind.DONE, payload={"axis": axis.value, "points": points}
    )


def sweep(
    config: NetworkSimulationConfig,
    axis: NetworkSweepAxis,
    values: Sequence[float],
) -> list[dict]:
    """Collect a sweep into a list of points.

    Consumes the same stream the realtime layer publishes, so a batch curve and
    a live one are built from identical numbers by construction.
    """
    collected = []
    for event in sweep_stream(config, axis, values):
        if event.kind is EventKind.SWEEP_POINT:
            collected.append(event.payload)
    return collected
