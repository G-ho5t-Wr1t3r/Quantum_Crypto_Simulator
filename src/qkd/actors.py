"""Who takes part in a run, where they stand, and what they are able to do.

DESIGN DECISIONS
================

1. Position belongs to the actor, valid positions belong to the attack
--------------------------------------------------------------------
These are two halves of one rule, living on opposite sides.

WHERE an attack can act is a property of the attack, not of whoever performs it:
intercept-resend needs a qubit in flight, and that is true regardless of who
Eve is. So `Attack` declares `valid_positions`.

WHO can do what is a property of the actor: Eve is an actor standing on the
channel who holds that capability. So `Actor` carries `position` and
`capabilities`.

The engine joins the two and refuses the combination if the actor's position is
not among the attack's valid ones. One check covers every attack, present and
future — which is exactly what the acceptance criterion asks for: the framework
must *prevent* InterceptResend at an endpoint, rather than merely not doing it.

Putting the positions inside the actor would scatter that rule across every
actor; putting the capabilities inside the attack would stop the registry from
listing attacks without knowing who might use them.

2. Actors observe
-----------------
An actor is not a label. It accumulates a `view`: the partial, local record of
what it has seen. Alice knows her bits and her bases; Bob knows his bases and
his outcomes, never Alice's bits; Eve knows what she managed to measure and
where.

A run's raw result is omniscient by construction — it holds every sequence — and
that is fine for computing metrics, but it is not what any participant actually
knows. Keeping per-actor views separate matters for three reasons:

  * it is the threat model made visible: "what does Eve know after an
    intercept-resend" is answered by showing her view rather than describing it;
  * it is what the live panels at J4 display, and what the event schema at I3
    has to decide how to stream — who sees what, and when;
  * it keeps the code honest. If Bob's view were allowed to contain Alice's
    bits, some later piece of code would end up using them, and the simulation
    would quietly stop being a simulation of a protocol.

The views are deliberately thin for now. The hook exists so that I3 and J4 do
not have to reopen the actor model.
"""

from abc import ABC
from dataclasses import dataclass, field
from enum import Enum


class Position(Enum):
    """Where an actor stands with respect to the quantum channel.

    The distinction is the whole threat model in one enum. An ENDPOINT holds
    states legitimately, having prepared or received them; someone on the
    CHANNEL only ever sees qubits in transit and must interfere to learn
    anything.

    That is why intercept-resend leaves a QBER signature and a compromised
    endpoint does not: the attacker at an endpoint already has the data, so
    there is nothing to re-prepare and no error to introduce. QKD detects
    eavesdroppers on the line, not participants who have been compromised.
    """

    ENDPOINT = "endpoint"
    CHANNEL = "channel"


class Role(Enum):
    """What part an actor plays in the protocol."""

    SENDER = "sender"
    RECEIVER = "receiver"
    SOURCE = "source"       # emits entangled pairs in E91; measures nothing
    EAVESDROPPER = "eavesdropper"


@dataclass
class Actor(ABC):
    """A participant: an identity, a place to stand, and a set of abilities.

    Attributes:
        name: how this actor is referred to in events and in the interface.
        role: the part it plays.
        position: where it stands. Decides which attacks it may perform.
        capabilities: the attack plugins it is allowed to use. Empty for honest
            participants, which is what makes an attacker an actor with an extra
            ability rather than a different kind of object.
        view: the local record of what this actor has observed. Deliberately
            partial: it must never accumulate anything the actor could not know.
    """

    name: str
    role: Role
    position: Position
    capabilities: list = field(default_factory=list)
    view: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        # ABC alone would not prevent this: it only blocks instantiation when
        # there is at least one abstract method, and every method here is shared
        # and concrete. The guard is explicit because position is not a free
        # choice — it follows from what kind of participant this is, and a bare
        # Actor placed anywhere would let a caller invent a participant the
        # threat model does not describe.
        if type(self) is Actor:
            raise TypeError(
                "Actor is abstract; instantiate Player or Eavesdropper, whose "
                "position follows from the part they play"
            )

    def observe(self, key: str, value: object) -> None:
        """Record something this actor has learnt.

        Append-only by convention, one list per kind of observation, so that a
        view can be replayed in order — which is what the live panels need.

        The caller is responsible for only passing what this actor could
        legitimately know. That rule cannot be enforced from here, and stating
        it is the point: an actor's view is a claim about the protocol, and a
        claim that quietly included Alice's bits in Bob's view would invalidate
        every result read off it.
        """
        self.view.setdefault(key, []).append(value)

    def can_perform(self, attack: "object") -> bool:
        """Whether this actor holds `attack` and stands where it may be used.

        Both halves are required. Holding the capability is not enough if the
        actor is in the wrong place, and standing in the right place is not
        enough without the capability.
        """
        if attack not in self.capabilities:
            return False
        return self.position in attack.valid_positions

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.name!r}, {self.position.value})"


@dataclass
class Player(Actor):
    """A legitimate participant, standing at an endpoint.

    Alice, Bob, and Charlie — the source of entangled pairs in E91. A Player is
    honest by default, with no capabilities: an insider threat (Z2) is a Player
    that has been handed an attack whose valid positions include ENDPOINT, not
    a separate class.
    """

    def __init__(self, name: str, role: Role, capabilities: list | None = None):
        super().__init__(
            name=name,
            role=role,
            position=Position.ENDPOINT,
            capabilities=capabilities or [],
        )


@dataclass
class Eavesdropper(Actor):
    """An actor sitting on the channel, between the endpoints.

    Holds no legitimate part in the protocol and receives nothing by right:
    whatever it learns, it learns by interfering with qubits in transit — which
    is precisely why its presence is detectable at all.
    """

    def __init__(self, name: str = "Eve", capabilities: list | None = None):
        super().__init__(
            name=name,
            role=Role.EAVESDROPPER,
            position=Position.CHANNEL,
            capabilities=capabilities or [],
        )
