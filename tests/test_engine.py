"""Tests for qkd.registry and qkd.engine — the plugin layer and the core.

The acceptance criterion of this block: the engine must reproduce headless every
case the earlier blocks established, driven only by a configuration. If these
pass, the assignment is satisfied without any interface at all.
"""

import json
import math

import pytest

from qkd.actors import Position
from qkd.attacks import AttackNotAllowedError, InterceptResend
from qkd.channels import AmplitudeDamping, IdealChannel
from qkd.engine import EventKind, run, stream
from qkd.registry import (
    UnknownPluginError,
    available_attacks,
    available_channels,
    build_attack,
    build_channel,
    build_eavesdropper,
    describe,
)
from qkd.settings import (
    AttackConfig,
    AttackerPosition,
    AttackKind,
    ChannelConfig,
    ChannelKind,
    ProtocolKind,
    SimulationConfig,
)

SEED = 20260813


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_builds_the_ideal_channel(self):
        assert isinstance(build_channel(ChannelConfig()), IdealChannel)

    def test_builds_damping_from_gamma(self):
        built = build_channel(
            ChannelConfig(kind=ChannelKind.AMPLITUDE_DAMPING, gamma=0.3)
        )
        assert isinstance(built, AmplitudeDamping)
        assert built.gamma == 0.3

    def test_builds_damping_from_a_length(self):
        """Which of the two descriptions was used is preserved, not normalised."""
        built = build_channel(
            ChannelConfig(kind=ChannelKind.AMPLITUDE_DAMPING, length_km=15)
        )
        assert built.gamma == pytest.approx(0.5, abs=0.02)

    def test_no_attack_builds_nothing(self):
        """So that callers treat 'nobody listening' uniformly."""
        assert build_attack(AttackConfig()) is None
        assert build_eavesdropper(AttackConfig()) is None

    def test_builds_the_attacker_as_an_actor_on_the_channel(self):
        actor = build_eavesdropper(AttackConfig(kind=AttackKind.INTERCEPT_RESEND))
        assert actor.position is Position.CHANNEL
        assert isinstance(actor.capabilities[0], InterceptResend)

    def test_an_endpoint_attacker_is_built_as_a_compromised_participant(self):
        """Construction does not validate: refusing is the protocol's job.

        Keeping the two apart is what lets a test build an illegal placement and
        then check that the framework rejects it.
        """
        actor = build_eavesdropper(
            AttackConfig(
                kind=AttackKind.INTERCEPT_RESEND, position=AttackerPosition.ENDPOINT
            )
        )
        assert actor.position is Position.ENDPOINT

    def test_the_fraction_reaches_the_attack(self):
        actor = build_eavesdropper(
            AttackConfig(kind=AttackKind.INTERCEPT_RESEND, fraction=0.44)
        )
        assert actor.capabilities[0].fraction == 0.44

    def test_introspection_lists_what_this_build_can_do(self):
        assert "ideal" in available_channels()
        assert "amplitude_damping" in available_channels()

    def test_attacks_are_listed_with_their_valid_positions(self):
        """How the threat model reaches the interface.

        A client builds its options from this, so an impossible run cannot be
        assembled in the first place.
        """
        assert available_attacks()["intercept_resend"] == ["channel"]

    def test_the_description_is_json_serialisable(self):
        """It crosses an HTTP boundary, so it has to survive serialisation."""
        assert json.loads(json.dumps(describe()))["channels"]


# ---------------------------------------------------------------------------
# Engine — the cases of the earlier blocks, driven by configuration alone
# ---------------------------------------------------------------------------


class TestIdealCases:
    def test_bb84_on_an_ideal_line_gives_exactly_zero(self):
        result = run(SimulationConfig(n_qubits=400, seed=SEED))
        assert result.qber_mean == 0.0
        assert result.accepted

    def test_e91_on_an_ideal_line_violates_bell(self):
        result = run(
            SimulationConfig(
                protocol=ProtocolKind.E91, n_qubits=900, seed=SEED
            )
        )
        assert result.chsh_mean > 2
        assert result.accepted

    def test_bb84_reports_no_bell_parameter(self):
        """The absence is meaningful and is preserved rather than zeroed."""
        assert run(SimulationConfig(n_qubits=100, seed=SEED)).chsh_mean is None


class TestNoisyCases:
    def test_damping_raises_the_error_rate(self):
        config = SimulationConfig(
            n_qubits=600,
            seed=SEED,
            channel={"kind": "amplitude_damping", "gamma": 0.5},
        )
        assert run(config).qber_mean > 0.1

    def test_the_two_bases_are_reported_separately(self):
        """E4's result, reachable from a configuration alone.

        A single pooled figure would average away the asymmetry that identifies
        amplitude damping, so the engine reports both.
        """
        config = SimulationConfig(
            n_qubits=800,
            seed=SEED,
            channel={"kind": "amplitude_damping", "gamma": 0.6},
        )
        by_basis = run(config).trials[0].qber_by_basis
        assert by_basis["rectilinear"] > by_basis["diagonal"]

    def test_a_configuration_in_kilometres_produces_noise(self):
        config = SimulationConfig(
            n_qubits=400,
            seed=SEED,
            channel={"kind": "amplitude_damping", "length_km": 15},
        )
        assert run(config).qber_mean > 0.05


class TestAttackedCases:
    def test_full_interception_reaches_about_25_percent(self):
        config = SimulationConfig(
            n_qubits=800,
            seed=SEED,
            attack={"kind": "intercept_resend"},
        )
        result = run(config)
        tol = 4 * math.sqrt(0.25 * 0.75 / (800 / 2))
        assert result.qber_mean == pytest.approx(0.25, abs=tol)

    def test_a_fully_intercepted_run_is_rejected_by_the_policy(self):
        """25% is far above any usable threshold: the engine says so."""
        config = SimulationConfig(
            n_qubits=600, seed=SEED, attack={"kind": "intercept_resend"}
        )
        result = run(config)
        assert not result.accepted
        assert "QBER" in result.reason

    def test_a_partial_attack_can_stay_under_the_threshold(self):
        """The security point, expressed entirely through configuration."""
        config = SimulationConfig(
            n_qubits=800,
            seed=SEED,
            attack={"kind": "intercept_resend", "fraction": 0.3},
        )
        assert run(config).qber_mean < 0.15

    def test_interception_destroys_the_bell_violation(self):
        config = SimulationConfig(
            protocol=ProtocolKind.E91,
            n_qubits=900,
            seed=SEED,
            attack={"kind": "intercept_resend"},
        )
        result = run(config)
        assert abs(result.chsh_mean) <= 2
        assert not result.accepted

    def test_an_endpoint_attacker_is_refused(self):
        """The threat model enforced end to end, from configuration to run."""
        config = SimulationConfig(
            n_qubits=50,
            seed=SEED,
            attack={"kind": "intercept_resend", "position": "endpoint"},
        )
        with pytest.raises(AttackNotAllowedError):
            run(config)

    def test_the_refusal_happens_before_any_trial(self):
        config = SimulationConfig(
            n_qubits=100_000,
            seed=SEED,
            attack={"kind": "intercept_resend", "position": "endpoint"},
        )
        with pytest.raises(AttackNotAllowedError):
            next(stream(config))


# ---------------------------------------------------------------------------
# Events and aggregation
# ---------------------------------------------------------------------------


class TestStream:
    def test_the_stream_opens_and_closes_around_one_event_per_trial(self):
        config = SimulationConfig(n_qubits=60, trials=3, seed=SEED)
        events = list(stream(config))

        assert events[0].kind is EventKind.STARTED
        assert events[-1].kind is EventKind.DONE
        assert [e.kind for e in events[1:-1]] == [EventKind.TRIAL] * 3

    def test_trials_are_numbered_in_order(self):
        config = SimulationConfig(n_qubits=40, trials=4, seed=SEED)
        indices = [e.index for e in stream(config) if e.kind is EventKind.TRIAL]
        assert indices == [0, 1, 2, 3]

    def test_every_payload_is_json_serialisable(self):
        """The events cross a WebSocket, so they must survive serialisation."""
        config = SimulationConfig(n_qubits=40, trials=2, seed=SEED)
        for event in stream(config):
            json.dumps(event.payload)

    def test_the_batch_result_matches_the_stream(self):
        """Same code path, so a live view and a batch result cannot disagree."""
        config = SimulationConfig(n_qubits=100, trials=2, seed=SEED)
        from_stream = [e for e in stream(config) if e.kind is EventKind.DONE][0]
        assert run(config).as_dict() == from_stream.payload

    def test_trials_differ_from_one_another(self):
        """Each trial derives its own seed from the configured one.

        Reusing a single seed would produce identical trials and a spread of
        exactly zero, which would look like remarkable precision and be an
        artefact.
        """
        config = SimulationConfig(
            n_qubits=400,
            trials=3,
            seed=SEED,
            attack={"kind": "intercept_resend"},
        )
        qbers = [t.qber for t in run(config).trials]
        assert len(set(qbers)) > 1

    def test_the_spread_is_reported_alongside_the_mean(self):
        config = SimulationConfig(
            n_qubits=300, trials=3, seed=SEED, attack={"kind": "intercept_resend"}
        )
        result = run(config)
        assert result.qber_stdev > 0

    def test_the_whole_run_is_reproducible(self):
        config = SimulationConfig(
            n_qubits=200, trials=2, seed=SEED, attack={"kind": "intercept_resend"}
        )
        assert run(config).as_dict() == run(config).as_dict()


class TestUnknownPlugins:
    def test_an_unregistered_channel_is_reported_clearly(self):
        class Fake:
            value = "does_not_exist"

        config = ChannelConfig()
        object.__setattr__(config, "kind", Fake())
        with pytest.raises(UnknownPluginError, match="available"):
            build_channel(config)
