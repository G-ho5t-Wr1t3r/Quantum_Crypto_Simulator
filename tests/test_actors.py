"""Tests for qkd.actors and qkd.attacks — F1, F2, F3.

The one that matters is TestPlacementValidation: the acceptance criterion for
workstream F asks that the framework *refuse* an attack in an invalid position,
not merely avoid performing it there.
"""

import pytest

from qkd.actors import Actor, Eavesdropper, Player, Position, Role
from qkd.attacks import Attack, AttackNotAllowedError, validate_placement


class _ChannelOnlyAttack(Attack):
    """Stand-in for InterceptResend, which arrives at F4."""

    name = "channel_only"
    valid_positions = frozenset({Position.CHANNEL})

    def intercept(self, circuit, qubit, rng):
        return circuit


class _AnywhereAttack(Attack):
    """An attack that works from either side, as an insider threat would."""

    name = "anywhere"
    valid_positions = frozenset({Position.CHANNEL, Position.ENDPOINT})

    def intercept(self, circuit, qubit, rng):
        return circuit


class TestActorContract:
    def test_actor_is_abstract(self):
        with pytest.raises(TypeError):
            Actor(name="x", role=Role.SENDER, position=Position.ENDPOINT)

    def test_a_player_stands_at_an_endpoint(self):
        assert Player("Alice", Role.SENDER).position is Position.ENDPOINT

    def test_an_eavesdropper_stands_on_the_channel(self):
        assert Eavesdropper().position is Position.CHANNEL

    def test_honest_participants_hold_no_capabilities(self):
        """An attacker is an actor with an extra ability, not another species."""
        assert Player("Bob", Role.RECEIVER).capabilities == []

    def test_actors_do_not_share_mutable_state(self):
        """Guards against a default argument shared across every instance."""
        alice, bob = Player("Alice", Role.SENDER), Player("Bob", Role.RECEIVER)
        alice.observe("bases", 0)
        assert bob.view == {}


class TestViews:
    def test_observations_accumulate_in_order(self):
        """Views are replayed in order by the live panels at J4."""
        alice = Player("Alice", Role.SENDER)
        for basis in (0, 1, 1):
            alice.observe("bases", basis)
        assert alice.view["bases"] == [0, 1, 1]

    def test_each_actor_keeps_its_own_view(self):
        """The point of per-actor views: nobody is omniscient.

        A run's raw result holds every sequence, which is right for computing
        metrics and wrong as a description of what anyone knows. Bob must not be
        able to read Alice's bits off his own view.
        """
        alice, bob = Player("Alice", Role.SENDER), Player("Bob", Role.RECEIVER)
        alice.observe("bits", 1)
        bob.observe("outcomes", 0)

        assert "bits" not in bob.view
        assert "outcomes" not in alice.view


class TestPlacementValidation:
    """The acceptance criterion of workstream F."""

    def test_a_channel_attack_is_refused_at_an_endpoint(self):
        """InterceptResend at an ENDPOINT must raise, not be tolerated.

        The physics: intercept-resend is defined on a qubit in flight — measure,
        re-prepare, forward. An actor at an endpoint already holds the state, so
        there is nothing to re-prepare and no error is induced. That is a
        different threat, an insider, and crucially one with no QBER signature.
        Refusing the combination states that in the framework rather than in a
        comment.
        """
        with pytest.raises(AttackNotAllowedError):
            validate_placement(_ChannelOnlyAttack(), Position.ENDPOINT)

    def test_a_channel_attack_is_accepted_on_the_channel(self):
        validate_placement(_ChannelOnlyAttack(), Position.CHANNEL)

    def test_an_attack_valid_everywhere_is_accepted_at_both(self):
        """Z2's insider threat is a placement, not a new kind of attack."""
        for position in (Position.CHANNEL, Position.ENDPOINT):
            validate_placement(_AnywhereAttack(), position)

    def test_the_error_says_where_the_attack_would_have_been_valid(self):
        with pytest.raises(AttackNotAllowedError, match="channel"):
            validate_placement(_ChannelOnlyAttack(), Position.ENDPOINT)


class TestCapabilities:
    def test_both_halves_are_required(self):
        """Holding the attack and standing in the right place are separate."""
        attack = _ChannelOnlyAttack()

        eve = Eavesdropper(capabilities=[attack])
        assert eve.can_perform(attack)

        # Right place, no capability.
        assert not Eavesdropper().can_perform(attack)

        # Has the capability, wrong place.
        insider = Player("Bob", Role.RECEIVER, capabilities=[attack])
        assert not insider.can_perform(attack)

    def test_an_endpoint_actor_can_perform_an_endpoint_attack(self):
        attack = _AnywhereAttack()
        insider = Player("Bob", Role.RECEIVER, capabilities=[attack])
        assert insider.can_perform(attack)


class TestAttackContract:
    def test_attack_is_abstract(self):
        with pytest.raises(TypeError):
            Attack()

    def test_a_subclass_must_implement_intercept(self):
        class Incomplete(Attack):
            name = "incomplete"
            valid_positions = frozenset({Position.CHANNEL})

        with pytest.raises(TypeError):
            Incomplete()

    def test_valid_positions_are_immutable(self):
        """A threat model that callers could edit at runtime is not a model."""
        assert isinstance(_ChannelOnlyAttack.valid_positions, frozenset)
