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

DESIGN DECISION — protocols take an actor, not an attack
=========================================================
`bb84.run` and `e91.run` accept an `eavesdropper: Actor`, whose capabilities are
performed in transit, rather than an attack on its own.

That is what makes the machinery of F1-F3 do real work: the position comes from
the actor, the valid positions from the attack, and `validate_placement` joins
the two. Passing an attack alone would leave the caller to supply a position out
of thin air, and the threat model would stop meaning anything — an attack is not
dangerous in the abstract, it is dangerous *from somewhere*.

The check runs before the simulation starts, not lazily at the first qubit. The
acceptance criterion asks that the framework PREVENT an attack in an impossible
position, and preventing it after an hour of computation is not preventing it.
"""

from abc import ABC, abstractmethod

import numpy as np
from qiskit import ClassicalRegister, QuantumCircuit

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


class InterceptResend(Attack):
    """Eve measures the qubit in flight, then re-prepares and forwards it.

    WHY IT IS ONLY VALID ON THE CHANNEL
    ------------------------------------
    The attack is defined on a qubit in transit: intercept it, measure it,
    prepare a fresh one matching the result, send that on. An actor at an
    ENDPOINT already holds the state legitimately, so there is nothing to
    intercept and nothing to re-prepare — that is an insider threat, a different
    attack with a different signature, and crucially one that induces no error
    and therefore cannot be caught by the QBER.

    WHY IT PRODUCES 25%
    -------------------
    On a sifted position, Alice and Bob used the same basis, so without Eve the
    outcome is deterministic. Eve picks her basis blind:

        she picks Alice's basis        p = 1/2   she measures an eigenstate, does
                                                 not disturb it, re-prepares the
                                                 same state. Bob reads correctly:
                                                 ERROR 0 — and Eve has stolen the
                                                 bit leaving no trace at all.

        she picks the other basis      p = 1/2   the state always collapses into
                                                 her basis and she forwards an
                                                 eigenstate of the wrong one. Bob
                                                 measures it in an incompatible
                                                 basis, so his result is a coin
                                                 flip: ERROR 1/2.

        QBER = 1/2 * 0 + 1/2 * 1/2 = 25%

    The first 1/2 is Eve's *choice*, not a mistake of hers. The second is chance
    acting on BOB's measurement, and exists only inside the second branch. Note
    that this is why the figure is 25% and not 50%: half of Eve's wrong guesses
    are covered by luck, Bob landing on Alice's bit anyway.

    PARTIAL INTERCEPTION
    --------------------
    With `fraction` = f, the two populations are independent: error 25% on the
    intercepted qubits, 0 on those left alone. A weighted mean between a
    constant and zero is linear in the weight:

        QBER(f) = 0.25 * f

    which matters for security rather than for tidiness. Against a threshold of
    about 11%, Eve solves 0.25f = 0.11 and finds f ~ 0.44: she can intercept
    44% of the traffic, stay under the alarm, and still learn roughly 22% of the
    sifted key perfectly.

    HOW IT IS SIMULATED
    -------------------
    Eve's measurement is a mid-circuit measurement in her chosen basis: rotate
    into that basis, measure, rotate back. No reset and no conditional
    re-preparation are needed, because the collapse *is* the preparation — after
    the measurement the qubit already sits in the eigenstate matching the
    outcome, which is exactly the state Eve would have built by hand. Shorter
    than reconstructing it explicitly, and closer to what actually happens.

    The measurement writes into a classical register of its own, which is what
    Eve learns. Qiskit separates registers with a space in the keys returned by
    get_counts, most recently added first, so both protocols read the first
    field to recover their own measurement — with or without anyone listening.
    Recording that register on the attacker's view is what the visualisation at
    J4 will show as "what Eve knows"; the hook is in Actor.observe, the wiring
    waits for the event schema at I3.
    """

    name = "intercept_resend"
    valid_positions = frozenset({Position.CHANNEL})

    def __init__(self, fraction: float = 1.0):
        """
        Args:
            fraction: share of qubits Eve chooses to touch, in [0, 1]. At 1 she
                intercepts everything and the QBER reaches 25%; below that it
                falls linearly, which is the knob a real adversary would turn to
                stay under the detection threshold.

        Raises:
            ValueError: if fraction lies outside [0, 1].
        """
        if not 0.0 <= fraction <= 1.0:
            raise ValueError(f"fraction must lie in [0, 1], got {fraction}")
        self.fraction = fraction

    def intercept(
        self,
        circuit: QuantumCircuit,
        qubit: int,
        rng: np.random.Generator,
    ) -> QuantumCircuit:
        """Measure `qubit` in a basis drawn at random, and forward the result.

        Does not mutate the argument, same contract as Channel.apply.

        Args:
            circuit: the qubit in transit.
            qubit: index of the qubit under attack. On E91 this is one arm, not
                both: attacking a single arm is what F6 needs.
            rng: seeded generator — Eve's basis choices are part of the run and
                have to be reproducible like everything else.

        Returns:
            The circuit that continues towards the receiver.
        """
        if rng.random() >= self.fraction:
            return circuit.copy()

        attacked = circuit.copy()
        register = ClassicalRegister(1, f"eve_{len(attacked.cregs)}")
        attacked.add_register(register)

        # Eve's basis, drawn blind: 0 rectilinear, 1 diagonal, matching the
        # convention bb84.prepare fixes.
        basis = int(rng.integers(0, 2))

        if basis == 1:
            attacked.h(qubit)
        attacked.measure(qubit, register[0])
        if basis == 1:
            attacked.h(qubit)

        return attacked

