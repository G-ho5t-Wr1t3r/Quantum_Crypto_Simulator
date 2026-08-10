"""Attacks: what an adversary does, and where it is allowed to do it.

DESIGN DECISION — the threat model lives in the code
====================================================
Every attack declares `valid_positions`, the set of places from which it can be
performed. This is not bookkeeping: it is the threat model written down where it
can be checked, instead of left implicit in whichever code path happens to call
what.

Intercept-resend declares {CHANNEL} because it is defined on a qubit in flight:
measure it, re-prepare, send it on. An actor at an ENDPOINT already holds the
state legitimately, so "intercepting" there is a different threat — an insider —
with a different signature: no re-preparation, therefore no induced error,
therefore no QBER to detect it by.

That asymmetry is the bridge to the Network Security chapter. QKD detects
eavesdroppers on the line; it does not, and cannot, detect a participant who has
been compromised. Making the framework *refuse* an attack in an invalid position
states that limitation as a property of the model rather than a footnote.
"""

from abc import ABC, abstractmethod

from qkd.actors import Position


class Attack(ABC):
    """Something an adversary can do to a run.

    Subclasses declare:

        name             a stable identifier, used by the configuration, the
                         registry at H1 and the saved presets
        valid_positions  where this attack may be performed at all
    """

    name: str
    valid_positions: frozenset[Position]

    @abstractmethod
    def intercept(self, circuit, qubit, rng):
        """Act on a qubit in flight, returning what continues to the receiver.

        Called by the engine at the point the attack applies — for a channel
        attack, between the sender's preparation and the receiver's
        measurement, in the same place a channel acts.

        Implementations record what they learn on the attacker's view, because
        what the adversary ends up knowing is the result the security argument
        turns on, not a by-product.

        Args:
            circuit: the qubit in transit. Must not be mutated, same contract as
                Channel.apply.
            qubit: index of the qubit under attack.
            rng: seeded generator, so an attacked run stays reproducible.

        Returns:
            The circuit that continues towards the receiver.
        """

    def is_allowed_at(self, position: Position) -> bool:
        """Whether this attack may be performed from `position`."""
        return position in self.valid_positions

    def __repr__(self) -> str:
        return f"{type(self).__name__}()"


class AttackNotAllowedError(ValueError):
    """Raised when an attack is placed where it cannot physically act.

    A distinct type rather than a bare ValueError because this is the framework
    enforcing the threat model, and the acceptance criterion for F asks for
    exactly that: InterceptResend at an ENDPOINT must be *refused*, not silently
    tolerated and not quietly turned into a no-op.
    """


def validate_placement(attack: Attack, position: Position) -> None:
    """Refuse an attack that cannot act from where it has been placed.

    One check, in one place, covering every attack that exists or will exist —
    which is why the valid positions belong to the attack and the position
    belongs to the actor.

    Raises:
        AttackNotAllowedError: if the position is not among the attack's valid
            ones.
    """
    if not attack.is_allowed_at(position):
        allowed = ", ".join(sorted(p.value for p in attack.valid_positions))
        raise AttackNotAllowedError(
            f"{attack.name} cannot be performed from {position.value}; "
            f"valid positions: {allowed}"
        )
