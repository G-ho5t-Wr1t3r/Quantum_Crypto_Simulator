"""Tests for qkd.settings — configuration and policy.

The acceptance criteria: a configuration validates or refuses its parameters,
the schema is produced from the models, and presets survive a round trip
through a file.
"""

import json
import math

import pytest
from pydantic import ValidationError

from qkd.settings import (
    AttackConfig,
    AttackerPosition,
    AttackKind,
    ChannelConfig,
    ChannelKind,
    ProtocolKind,
    SecurityPolicy,
    SimulationConfig,
    json_schema,
    write_json_schema,
)


class TestChannelConfig:
    def test_ideal_is_the_default(self):
        assert ChannelConfig().kind is ChannelKind.IDEAL

    def test_an_ideal_channel_refuses_parameters(self):
        """Passing gamma to a lossless line is a contradiction, not a nuance."""
        with pytest.raises(ValidationError):
            ChannelConfig(kind=ChannelKind.IDEAL, gamma=0.3)

    def test_damping_accepts_gamma_alone(self):
        assert ChannelConfig(kind=ChannelKind.AMPLITUDE_DAMPING, gamma=0.3).gamma == 0.3

    def test_damping_accepts_a_length_alone(self):
        config = ChannelConfig(kind=ChannelKind.AMPLITUDE_DAMPING, length_km=15)
        assert config.length_km == 15

    def test_damping_refuses_both_parameters(self):
        """They describe the same channel, so accepting both means ignoring one.

        Silently resolving the conflict would be worse than failing: the run
        would proceed under a parameter the caller did not choose.
        """
        with pytest.raises(ValidationError):
            ChannelConfig(kind=ChannelKind.AMPLITUDE_DAMPING, gamma=0.3, length_km=15)

    def test_damping_refuses_neither(self):
        with pytest.raises(ValidationError):
            ChannelConfig(kind=ChannelKind.AMPLITUDE_DAMPING)

    def test_gamma_is_bounded_to_a_probability(self):
        with pytest.raises(ValidationError):
            ChannelConfig(kind=ChannelKind.AMPLITUDE_DAMPING, gamma=1.4)

    def test_unknown_fields_are_rejected(self):
        """A typo in a preset must fail loudly, not be ignored."""
        with pytest.raises(ValidationError):
            ChannelConfig(kind=ChannelKind.IDEAL, gama=0.3)


class TestAttackConfig:
    def test_no_attack_is_the_default(self):
        assert AttackConfig().kind is AttackKind.NONE

    def test_an_illegal_position_is_expressible(self):
        """The configuration must be able to state the case that gets refused.

        Validation of the placement belongs to the attack, which declares where
        it can act. If the configuration could not express an endpoint attacker,
        the framework would have nothing to refuse and the constraint would be
        untestable.
        """
        config = AttackConfig(
            kind=AttackKind.INTERCEPT_RESEND,
            position=AttackerPosition.ENDPOINT,
        )
        assert config.position is AttackerPosition.ENDPOINT

    def test_fraction_is_bounded(self):
        with pytest.raises(ValidationError):
            AttackConfig(kind=AttackKind.INTERCEPT_RESEND, fraction=1.2)

    def test_a_fraction_without_an_attack_is_refused(self):
        with pytest.raises(ValidationError):
            AttackConfig(kind=AttackKind.NONE, fraction=0.5)


class TestSecurityPolicy:
    def test_defaults_are_the_documented_ones(self):
        policy = SecurityPolicy()
        assert policy.qber_threshold == 0.11
        assert policy.chsh_confidence == 3

    def test_qber_at_the_threshold_is_accepted(self):
        assert SecurityPolicy().accepts_qber(0.11)

    def test_qber_above_the_threshold_is_refused(self):
        """A full interception sits at 25%, comfortably over any usable bound."""
        assert not SecurityPolicy().accepts_qber(0.25)

    def test_a_bare_crossing_of_two_is_not_a_violation(self):
        """S = 2.05 with sigma = 0.25 is noise, not a Bell violation.

        This is what the margin is for: a genuinely classical state crosses the
        bound by chance on a finite sample, and a plain comparison against 2
        would report it as entanglement.
        """
        assert not SecurityPolicy().accepts_chsh(2.05, uncertainty=0.25)

    def test_an_ideal_violation_with_a_small_uncertainty_is_accepted(self):
        assert SecurityPolicy().accepts_chsh(2 * math.sqrt(2), uncertainty=0.1)

    def test_the_sign_of_s_does_not_matter(self):
        """The singlet gives the same magnitude with the opposite sign."""
        policy = SecurityPolicy()
        assert policy.accepts_chsh(-2.83, 0.1) == policy.accepts_chsh(2.83, 0.1)

    def test_sample_size_for_an_ideal_violation(self):
        """n > (2k/(|S|-2))**2 gives 53 pairs per setting at k = 3."""
        assert SecurityPolicy().pairs_needed_for(2 * math.sqrt(2)) == 53

    def test_the_cost_explodes_near_the_classical_bound(self):
        """Noise pushing S to 2.1 needs thousands of pairs instead of dozens.

        The reason a violation stops being declarable well before S reaches 2.
        """
        policy = SecurityPolicy()
        assert policy.pairs_needed_for(2.1) == 3600
        assert policy.pairs_needed_for(2.1) > 50 * policy.pairs_needed_for(2 * math.sqrt(2))

    def test_no_sample_size_certifies_a_non_violation(self):
        with pytest.raises(ValueError):
            SecurityPolicy().pairs_needed_for(1.9)

    def test_a_stricter_confidence_demands_more_pairs(self):
        lenient = SecurityPolicy(chsh_confidence=1)
        strict = SecurityPolicy(chsh_confidence=5)
        assert strict.pairs_needed_for(2.5) > lenient.pairs_needed_for(2.5)


class TestSimulationConfig:
    def test_defaults_describe_a_runnable_ideal_bb84(self):
        config = SimulationConfig()
        assert config.protocol is ProtocolKind.BB84
        assert config.channel.kind is ChannelKind.IDEAL
        assert config.attack.kind is AttackKind.NONE
        assert config.n_qubits > 0

    def test_the_seed_is_part_of_the_configuration(self):
        """A run whose seed is not recorded cannot be reproduced."""
        assert "seed" in SimulationConfig().model_dump()

    def test_a_negative_count_is_refused(self):
        with pytest.raises(ValidationError):
            SimulationConfig(n_qubits=0)

    def test_nested_validation_reaches_the_channel(self):
        with pytest.raises(ValidationError):
            SimulationConfig(channel={"kind": "amplitude_damping"})

    def test_a_full_configuration_round_trips_through_a_file(self, tmp_path):
        """Presets are saved and reloaded, revalidated on the way back in."""
        original = SimulationConfig(
            protocol=ProtocolKind.E91,
            n_qubits=1200,
            seed=20260813,
            channel={"kind": "amplitude_damping", "length_km": 15},
            attack={"kind": "intercept_resend", "fraction": 0.44},
            security={"qber_threshold": 0.11, "chsh_confidence": 3},
        )
        path = tmp_path / "preset.json"
        original.save(path)

        assert SimulationConfig.load(path) == original

    def test_a_hand_edited_preset_is_validated_on_load(self, tmp_path):
        """Loading is not parsing: a file edited by hand faces the same rules."""
        path = tmp_path / "broken.json"
        path.write_text(
            json.dumps({"channel": {"kind": "amplitude_damping"}}), encoding="utf-8"
        )
        with pytest.raises(ValidationError):
            SimulationConfig.load(path)


class TestJsonSchema:
    def test_the_schema_is_generated_from_the_models(self):
        schema = json_schema()
        assert "properties" in schema
        assert {"protocol", "n_qubits", "seed", "channel", "attack", "security"} <= set(
            schema["properties"]
        )

    def test_closed_choices_appear_as_enumerations(self):
        """What lets the interface offer the legal options instead of a text box."""
        definitions = json_schema()["$defs"]
        assert set(definitions["ProtocolKind"]["enum"]) == {"bb84", "e91"}
        assert set(definitions["ChannelKind"]["enum"]) == {"ideal", "amplitude_damping"}

    def test_bounds_survive_into_the_schema(self):
        """So that the form can refuse an impossible value before submitting."""
        gamma = json_schema()["$defs"]["ChannelConfig"]["properties"]["gamma"]
        assert json.dumps(gamma).find("maximum") != -1

    def test_descriptions_survive_into_the_schema(self):
        """They become the help text next to each field."""
        seed = json_schema()["properties"]["seed"]
        assert "description" in seed

    def test_the_schema_can_be_written_out(self, tmp_path):
        path = tmp_path / "schema.json"
        write_json_schema(path)
        assert json.loads(path.read_text(encoding="utf-8"))["title"] == "SimulationConfig"
