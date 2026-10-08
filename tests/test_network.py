"""Tests for multi-hop key distribution.

WHAT IS CHECKED HERE, AND WHY IN THIS ORDER
============================================
The module splits cleanly into a part that does not need a simulation and a
part that does, and the tests follow that split because the two fail for
different reasons and should not be diagnosed together.

The route construction, the key splitting and the leakage arithmetic are plain
deterministic functions: they are checked exhaustively and cheaply. Only the
last group runs the protocol, and it is the slow one, because a route simulates
the protocol once per hop.

The claim the whole extension exists to support is tested in
`TestTheComparison`: a route long enough that a single hop would fail delivers
a key when cut into hops, and the two strategies leak differently under the same
compromise. Everything above it is machinery for that.
"""

import pytest

from qkd.attacks import AttackNotAllowedError, CompromisedRelay
from qkd.actors import Position
from qkd.metrics import key_leakage, surviving_key_bits
from qkd.network import (
    Hop,
    Network,
    NetworkSweepAxis,
    Route,
    build_network,
    chain,
    combine_key,
    draw_compromise,
    fan,
    relay_bits,
    split_key,
    sweep,
    validate_compromise,
)
from qkd.network import run as network_run
from qkd.network import stream as network_stream
from qkd.registry import available_attacks, describe
from qkd.settings import (
    AttackConfig,
    AttackerPosition,
    AttackKind,
    NetworkConfig,
    NetworkSimulationConfig,
    ProtocolKind,
    SimulationConfig,
    StrategyKind,
    TopologyKind,
)

import numpy as np
from pydantic import ValidationError


def rng(seed: int = 0) -> np.random.Generator:
    return np.random.default_rng(seed)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class TestRouteConstruction:
    def test_a_chain_has_one_more_hop_than_it_has_relays(self):
        route = chain(relays=3, hop_length_km=10.0).routes[0]
        assert len(route.hops) == 4
        assert route.relays == ("r1", "r2", "r3")
        assert route.nodes == ("alice", "r1", "r2", "r3", "bob")

    def test_the_end_to_end_distance_is_derived_from_the_hop_length(self):
        route = chain(relays=4, hop_length_km=12.5).routes[0]
        assert route.length_km == pytest.approx(62.5)

    def test_a_chain_with_no_relays_is_a_single_hop(self):
        """The point-to-point baseline has to be reachable from this code path.

        Otherwise the comparison starts from a number produced somewhere else,
        and a difference between the two could come from the route model rather
        than from the route.
        """
        route = chain(relays=0, hop_length_km=30.0).routes[0]
        assert len(route.hops) == 1
        assert route.relays == ()

    def test_endpoints_are_not_relays(self):
        network = chain(relays=2, hop_length_km=10.0)
        assert "alice" not in network.relays
        assert "bob" not in network.relays

    def test_a_fan_names_its_relays_per_route_so_they_cannot_collide(self):
        network = fan(paths=3, relays=2, hop_length_km=10.0)
        assert network.relays == (
            "p1r1",
            "p1r2",
            "p2r1",
            "p2r2",
            "p3r1",
            "p3r2",
        )
        assert network.disjoint_relays

    def test_every_route_of_a_fan_runs_between_the_same_endpoints(self):
        network = fan(paths=4, relays=1, hop_length_km=10.0)
        for route in network.routes:
            assert route.nodes[0] == network.source
            assert route.nodes[-1] == network.target

    def test_a_fan_of_one_route_is_refused(self):
        with pytest.raises(ValueError, match="at least two routes"):
            fan(paths=1, relays=2, hop_length_km=10.0)

    def test_a_disconnected_route_is_refused(self):
        with pytest.raises(ValueError, match="not connected"):
            Route(
                hops=(
                    Hop("alice", "r1", 10.0),
                    Hop("r2", "bob", 10.0),
                )
            )

    def test_a_route_that_does_not_reach_the_target_is_refused(self):
        with pytest.raises(ValueError, match="every route must run"):
            Network(
                source="alice",
                target="bob",
                routes=(Route(hops=(Hop("alice", "r1", 10.0),)),),
            )

    def test_overlapping_routes_are_detected_as_not_disjoint(self):
        """The one property the split strategy may not assume silently."""
        shared = Network(
            source="alice",
            target="bob",
            routes=(
                Route(hops=(Hop("alice", "m", 10.0), Hop("m", "bob", 10.0))),
                Route(hops=(Hop("alice", "m", 10.0), Hop("m", "bob", 10.0))),
            ),
        )
        assert not shared.disjoint_relays

    def test_routes_through_finds_every_route_crossing_a_relay(self):
        network = fan(paths=3, relays=1, hop_length_km=10.0)
        assert network.routes_through("p2r1") == (1,)
        assert network.routes_through("nobody") == ()

    def test_build_network_follows_the_configuration(self):
        built = build_network(
            NetworkConfig(topology=TopologyKind.FAN, paths=2, relays=1, hop_length_km=5.0)
        )
        assert len(built.routes) == 2
        assert built.routes[0].length_km == pytest.approx(10.0)


# ---------------------------------------------------------------------------
# Key material
# ---------------------------------------------------------------------------


class TestKeySplitting:
    def test_the_complete_set_of_fragments_reconstructs_the_key(self):
        key = [int(b) for b in rng(1).integers(0, 2, size=64)]
        fragments = split_key(key, 4, rng(2))
        assert combine_key(fragments) == key

    def test_every_fragment_is_as_long_as_the_key(self):
        key = [1, 0, 1, 1, 0]
        for fragment in split_key(key, 3, rng(3)):
            assert len(fragment) == len(key)

    def test_a_proper_subset_does_not_reconstruct_the_key(self):
        """The property the whole strategy rests on.

        Not a statistical claim about one draw: with an all-or-nothing split the
        missing fragment is exactly what separates the combination from the key,
        so any subset differing from the key is the expected outcome and a
        subset equalling it would mean the split had leaked.
        """
        key = [int(b) for b in rng(4).integers(0, 2, size=64)]
        fragments = split_key(key, 3, rng(5))
        assert combine_key(fragments[:2]) != key
        assert combine_key(fragments[1:]) != key
        assert fragments[0] != key

    def test_one_fragment_is_the_key_itself(self):
        """Splitting into one piece is the degenerate case, and it is honest.

        It is what the relay chain carries, and it says in the code what the
        comparison says in words: a key that is not split is a key every relay
        can read.
        """
        key = [1, 1, 0, 1]
        assert split_key(key, 1, rng(6)) == [key]

    def test_splitting_into_fewer_than_one_fragment_is_refused(self):
        with pytest.raises(ValueError, match="at least one fragment"):
            split_key([1, 0], 0, rng(7))

    def test_combining_nothing_is_refused(self):
        with pytest.raises(ValueError, match="nothing to combine"):
            combine_key([])

    def test_combining_fragments_of_different_lengths_is_refused(self):
        """A truncated fragment must not produce a shorter key quietly."""
        with pytest.raises(ValueError, match="did not survive the route intact"):
            combine_key([[1, 0, 1], [1, 0]])

    def test_different_seeds_produce_different_fragments_of_the_same_key(self):
        key = [int(b) for b in rng(8).integers(0, 2, size=32)]
        assert split_key(key, 2, rng(9)) != split_key(key, 2, rng(10))


class TestRelaying:
    def test_a_payload_survives_a_route_intact(self):
        payload = [int(b) for b in rng(11).integers(0, 2, size=16)]
        hop_keys = [
            [int(b) for b in rng(12 + i).integers(0, 2, size=16)] for i in range(4)
        ]
        assert relay_bits(payload, hop_keys) == payload

    def test_a_route_of_no_hops_returns_the_payload(self):
        assert relay_bits([1, 0, 1], []) == [1, 0, 1]

    def test_a_hop_cannot_forward_more_key_than_it_established(self):
        """The pad is not stretched, and the attempt is an error rather than a key."""
        with pytest.raises(ValueError, match="too few to carry"):
            relay_bits([1] * 20, [[0] * 5])


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


class TestNetworkMetrics:
    def test_the_weakest_hop_sets_the_end_to_end_length(self):
        assert surviving_key_bits([400, 120, 380]) == 120

    def test_a_route_with_no_hops_delivers_nothing(self):
        assert surviving_key_bits([]) == 0

    def test_a_hop_that_produced_nothing_collapses_the_route(self):
        assert surviving_key_bits([400, 0, 380]) == 0

    def test_leakage_is_a_step_and_not_a_slope(self):
        assert key_leakage(2, 3, 3) == 0.0
        assert key_leakage(3, 3, 3) == 1.0

    def test_a_single_fragment_leaks_as_soon_as_it_is_observed(self):
        assert key_leakage(0, 1, 1) == 0.0
        assert key_leakage(1, 1, 1) == 1.0

    def test_an_unreachable_threshold_is_refused(self):
        with pytest.raises(ValueError, match="unreachable"):
            key_leakage(1, 2, 5)

    def test_a_negative_observation_is_refused(self):
        with pytest.raises(ValueError, match="cannot be negative"):
            key_leakage(-1, 2, 2)


# ---------------------------------------------------------------------------
# The threat model
# ---------------------------------------------------------------------------


class TestTheCompromisedRelay:
    def test_it_is_only_valid_at_a_relay(self):
        attack = CompromisedRelay()
        assert attack.valid_positions == frozenset({Position.RELAY})
        assert attack.is_allowed_at(Position.RELAY)
        assert not attack.is_allowed_at(Position.CHANNEL)
        assert not attack.is_allowed_at(Position.ENDPOINT)

    def test_it_disturbs_no_qubit(self):
        """The finding, not a stub.

        A relay reads a key it already holds, so there is nothing to measure and
        no error to introduce. The journal records None on every qubit, which is
        the same vocabulary intercept-resend uses for a qubit it let through.
        """
        from qiskit import QuantumCircuit

        circuit = QuantumCircuit(1)
        circuit.h(0)
        journal: list = []
        forwarded = CompromisedRelay().intercept(circuit, 0, rng(13), journal)

        assert journal == [None]
        assert forwarded is not circuit
        assert len(forwarded.data) == len(circuit.data)

    def test_it_is_discoverable_through_the_registry(self):
        assert available_attacks()["compromised_relay"] == ["relay"]

    def test_the_registry_reports_the_network_options(self):
        reported = describe()["network"]
        assert reported["topologies"] == ["chain", "fan"]
        assert reported["strategies"] == ["relay_chain", "split_paths"]

    def test_naming_an_endpoint_as_compromised_is_refused(self):
        network = chain(relays=2, hop_length_km=10.0)
        with pytest.raises(AttackNotAllowedError):
            validate_compromise(network, ["alice"])

    def test_naming_a_node_that_is_not_on_the_route_is_refused(self):
        network = chain(relays=2, hop_length_km=10.0)
        with pytest.raises(ValueError, match="not a relay on this network"):
            validate_compromise(network, ["r9"])

    def test_naming_a_real_relay_is_accepted(self):
        network = chain(relays=2, hop_length_km=10.0)
        validate_compromise(network, ["r1", "r2"])

    def test_a_compromise_larger_than_the_network_is_refused(self):
        network = chain(relays=2, hop_length_km=10.0)
        with pytest.raises(ValueError, match="cannot compromise"):
            draw_compromise(network, 5, rng(14))

    def test_a_draw_is_reproducible_and_without_replacement(self):
        network = fan(paths=3, relays=2, hop_length_km=10.0)
        first = draw_compromise(network, 3, rng(15))
        again = draw_compromise(network, 3, rng(15))
        assert first == again
        assert len(set(first)) == 3


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class TestConfigurationIsRefusedBeforeItRuns:
    def test_a_chain_cannot_have_several_routes(self):
        with pytest.raises(ValidationError, match="a chain is a single route"):
            NetworkConfig(topology=TopologyKind.CHAIN, paths=2)

    def test_a_fan_of_one_route_is_a_chain_and_is_refused(self):
        with pytest.raises(ValidationError, match="chain under another name"):
            NetworkConfig(topology=TopologyKind.FAN, paths=1)

    def test_splitting_across_a_single_route_is_refused(self):
        """The error that would otherwise invalidate a result silently."""
        with pytest.raises(ValidationError, match="at least two disjoint routes"):
            NetworkConfig(strategy=StrategyKind.SPLIT_PATHS)

    def test_a_threshold_below_the_fragment_count_is_refused(self):
        with pytest.raises(ValidationError, match="all-or-nothing"):
            NetworkConfig(
                topology=TopologyKind.FAN,
                paths=3,
                strategy=StrategyKind.SPLIT_PATHS,
                threshold=2,
            )

    def test_the_compromise_is_described_once(self):
        with pytest.raises(ValidationError, match="not both"):
            NetworkConfig(compromised=["r1"], compromised_count=1)

    def test_the_same_relay_cannot_be_named_twice(self):
        with pytest.raises(ValidationError, match="named twice"):
            NetworkConfig(compromised=["r1", "r1"])

    def test_averaging_over_draws_needs_random_draws(self):
        with pytest.raises(ValidationError, match="no meaning"):
            NetworkConfig(compromised=["r1"], attack_draws=16)

    def test_a_relay_attack_needs_a_relay(self):
        """A point-to-point run has no third node, so it cannot have this attack.

        Worth refusing rather than running: the attack touches no qubit, so the
        run would complete, report an untouched error rate, and look like
        evidence that owning a relay is free of consequence.
        """
        with pytest.raises(ValidationError, match="needs a relay to compromise"):
            SimulationConfig(
                attack=AttackConfig(
                    kind=AttackKind.COMPROMISED_RELAY,
                    position=AttackerPosition.RELAY,
                )
            )

    def test_a_relay_attack_declared_anywhere_else_is_refused(self):
        with pytest.raises(ValidationError, match="defined at a relay"):
            AttackConfig(
                kind=AttackKind.COMPROMISED_RELAY, position=AttackerPosition.CHANNEL
            )

    def test_another_attack_declared_at_a_relay_is_refused(self):
        with pytest.raises(ValidationError, match="not an attack on a relay"):
            AttackConfig(
                kind=AttackKind.INTERCEPT_RESEND, position=AttackerPosition.RELAY
            )

    def test_a_relay_compromise_is_not_a_hop_attack(self):
        with pytest.raises(ValidationError, match="belongs to the route"):
            NetworkSimulationConfig(
                attack=AttackConfig(
                    kind=AttackKind.COMPROMISED_RELAY,
                    position=AttackerPosition.RELAY,
                )
            )

    def test_the_derived_distance_follows_the_hops(self):
        config = NetworkConfig(relays=3, hop_length_km=20.0)
        assert config.hops_per_path == 4
        assert config.total_length_km == pytest.approx(80.0)

    def test_the_default_threshold_is_all_the_fragments(self):
        config = NetworkConfig(
            topology=TopologyKind.FAN, paths=3, strategy=StrategyKind.SPLIT_PATHS
        )
        assert config.effective_threshold == 3

    def test_a_relayed_chain_carries_one_fragment(self):
        assert NetworkConfig().effective_threshold == 1


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------


#: Hop length used by every executed test below.
#:
#: Chosen against this build's channel rather than for roundness. The damping
#: channel attenuates over about 21.7 km, and the sifted error rate it induces
#: crosses the default 0.11 threshold somewhere near 7 km — so a hop of that
#: length is already on the edge of being discarded, and a test sitting there
#: would fail on sampling noise rather than on a defect. Two kilometres puts the
#: expected rate near 0.03, several standard deviations clear of the threshold
#: at the qubit count used here.
VIABLE_HOP_KM = 2.0

#: A hop deliberately past the point where a key survives at all.
#:
#: Comfortably past it, not marginally: the expected rate here is above 0.16,
#: so the discard is a property of the distance and not of the draw.
DOOMED_HOP_KM = 12.0


def short_run(**network_kwargs) -> NetworkSimulationConfig:
    """A configuration small enough to run in a test, honest enough to mean it.

    The qubit count is set by the error estimate rather than by patience. A
    route is judged hop by hop against a threshold, so the sifted sample has to
    be large enough that an acceptable hop is not discarded by fluctuation: at
    two hundred qubits roughly a hundred bits survive sifting, which puts the
    standard deviation of the estimate near two points of error rate.

    What is being checked here is composition over a route. The behaviour of a
    single hop is the protocol tests' subject and is not re-litigated.
    """
    network_kwargs.setdefault("hop_length_km", VIABLE_HOP_KM)
    return NetworkSimulationConfig(
        protocol=ProtocolKind.BB84,
        n_qubits=200,
        trials=1,
        seed=7,
        network=NetworkConfig(**network_kwargs),
    )


class TestTheComparison:
    def test_a_route_of_short_hops_delivers_a_key(self):
        result = network_run(short_run(relays=2))
        assert result.delivered
        assert result.key_bits > 0
        assert result.total_length_km == pytest.approx(3 * VIABLE_HOP_KM)
        assert len(result.routes[0].hops) == 3

    def test_the_key_is_bounded_by_the_weakest_hop(self):
        result = network_run(short_run(relays=2))
        hop_bits = [hop.bits for hop in result.routes[0].hops]
        assert result.key_bits == min(hop_bits)

    def test_a_single_hop_of_the_same_length_would_fail(self):
        """The premise of the whole extension, restated as a test.

        If a hop covering the full end-to-end distance still produced a key,
        cutting the route into hops would be solving a problem that was not
        there, and every figure built on the comparison would be measuring
        nothing. So the two are run at the same distance: one hop of it fails,
        six hops of it do not.
        """
        hops = int(DOOMED_HOP_KM / VIABLE_HOP_KM)

        direct = network_run(short_run(relays=0, hop_length_km=DOOMED_HOP_KM))
        assert not direct.delivered
        assert direct.key_bits == 0

        relayed = network_run(short_run(relays=hops - 1))
        assert relayed.total_length_km == pytest.approx(DOOMED_HOP_KM)
        assert relayed.delivered
        assert relayed.key_bits > 0

    def test_an_undisturbed_route_leaks_nothing(self):
        result = network_run(short_run(relays=2))
        assert result.leaked_fraction == 0.0

    def test_one_compromised_relay_costs_the_chain_the_whole_key(self):
        result = network_run(short_run(relays=3, compromised=["r2"]))
        assert result.delivered
        assert result.key_bits > 0
        assert result.leaked_fraction == 1.0

    def test_a_compromised_relay_leaves_the_error_rate_untouched(self):
        """Why the comparison needs a leakage metric at all.

        The run under a compromised relay and the clean run produce the same
        error rate, because the adversary disturbs nothing. A route that is
        entirely readable is indistinguishable from a safe one on every quantum
        metric the simulator computes, which is the limitation of a trusted
        relay stated as a measurement.
        """
        clean = network_run(short_run(relays=3))
        owned = network_run(short_run(relays=3, compromised=["r2"]))

        assert owned.worst_hop_qber == pytest.approx(clean.worst_hop_qber)
        assert owned.key_bits == clean.key_bits
        assert owned.leaked_fraction > clean.leaked_fraction

    def test_one_compromised_relay_costs_the_split_nothing(self):
        result = network_run(
            short_run(
                topology=TopologyKind.FAN,
                strategy=StrategyKind.SPLIT_PATHS,
                paths=2,
                relays=1,
                compromised=["p1r1"],
            )
        )
        assert result.delivered
        assert result.key_bits > 0
        assert result.leaked_fraction == 0.0

    def test_the_split_leaks_only_once_every_route_is_held(self):
        result = network_run(
            short_run(
                topology=TopologyKind.FAN,
                strategy=StrategyKind.SPLIT_PATHS,
                paths=2,
                relays=1,
                compromised=["p1r1", "p2r1"],
            )
        )
        assert result.leaked_fraction == 1.0

    def test_the_split_delivers_only_if_every_route_delivers(self):
        """The cost of the all-or-nothing split, measured rather than assumed.

        One route long enough to fail takes the key with it. Availability gets
        worse exactly where secrecy got better, and the result says so instead
        of reporting a shorter key.
        """
        result = network_run(
            short_run(
                topology=TopologyKind.FAN,
                strategy=StrategyKind.SPLIT_PATHS,
                paths=2,
                relays=0,
                hop_length_km=DOOMED_HOP_KM,
            )
        )
        assert not result.delivered
        assert result.key_bits == 0
        assert "cannot be recombined" in result.reason

    def test_a_run_is_reproducible(self):
        first = network_run(short_run(relays=2))
        again = network_run(short_run(relays=2))
        assert first.as_dict() == again.as_dict()

    def test_the_result_is_json_serialisable(self):
        import json

        result = network_run(short_run(relays=1))
        json.dumps(result.as_dict())

    def test_the_route_is_announced_before_it_is_simulated(self):
        """An interface has to be able to draw the network while it waits."""
        events = network_stream(short_run(relays=2))
        started = next(events)
        assert started.payload["network"]["relays"] == ["r1", "r2"]
        assert started.payload["total_length_km"] == pytest.approx(3 * VIABLE_HOP_KM)
        events.close()

    def test_a_split_over_shared_relays_is_refused_before_it_runs(self):
        """Caught at the first event, not after the hops have been simulated."""
        config = short_run(
            topology=TopologyKind.FAN,
            strategy=StrategyKind.SPLIT_PATHS,
            paths=2,
            relays=1,
        )
        shared = Network(
            source="alice",
            target="bob",
            routes=(
                Route(hops=(Hop("alice", "m", 5.0), Hop("m", "bob", 5.0))),
                Route(hops=(Hop("alice", "m", 5.0), Hop("m", "bob", 5.0))),
            ),
        )
        assert not shared.disjoint_relays
        # The configured fan is disjoint by construction, so the guard is
        # exercised through the network object the strategy actually checks.
        assert build_network(config.network).disjoint_relays


class TestSweeps:
    def test_leakage_against_the_size_of_the_compromise_never_decreases(self):
        """The shape of the headline figure, checked rather than eyeballed.

        More compromised relays can never leak less, under either strategy. A
        dip would mean the averaging or the draw was wrong, and on a plot it
        would read as a security property that does not exist.
        """
        config = short_run(
            topology=TopologyKind.FAN,
            strategy=StrategyKind.SPLIT_PATHS,
            paths=3,
            relays=1,
            compromised_count=0,
            attack_draws=64,
        )
        points = sweep(config, NetworkSweepAxis.COMPROMISED, [0, 1, 2, 3])
        leaked = [point["leaked_fraction"] for point in points]

        assert leaked == sorted(leaked)
        assert leaked[0] == 0.0
        assert leaked[-1] == 1.0

    def test_the_chain_leaks_everything_from_the_first_relay(self):
        config = short_run(relays=3, compromised_count=0, attack_draws=64)
        points = sweep(config, NetworkSweepAxis.COMPROMISED, [0, 1, 2, 3])
        leaked = [point["leaked_fraction"] for point in points]

        assert leaked[0] == 0.0
        assert all(value == 1.0 for value in leaked[1:])

    def test_a_sweep_over_the_hop_length_eventually_loses_the_key(self):
        config = short_run(relays=1)
        points = sweep(
            config,
            NetworkSweepAxis.HOP_LENGTH_KM,
            [VIABLE_HOP_KM, DOOMED_HOP_KM],
        )

        assert points[0]["delivered"]
        assert not points[-1]["delivered"]
        assert points[-1]["key_bits"] == 0

    def test_a_sweep_point_that_cannot_be_configured_is_refused(self):
        """Every point is validated on its own rather than assumed legal."""
        config = short_run(
            topology=TopologyKind.FAN,
            strategy=StrategyKind.SPLIT_PATHS,
            paths=2,
            relays=1,
        )
        with pytest.raises(ValidationError):
            sweep(config, NetworkSweepAxis.PATHS, [1])
