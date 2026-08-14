"""Plugin registry: turns a configuration into the objects that run it.

WHAT THIS BUYS, AND WHAT IT COSTS
==================================
Protocol, channel, attack and actor are independent axes rather than an
inheritance hierarchy, and this module is what composes them. The benefit is
that no class named BB84WithDampingAndEve ever has to exist: adding a channel
means adding a factory here, and nothing downstream changes.

The cost is real and worth stating. With inheritance a meaningless combination
simply is not a class, so the error surfaces while writing. With composition
anything can be assembled, so the error moves to run time — and if a check is
forgotten, it does not surface at all: the simulation returns numbers that look
legitimate. Every constraint the type system used to grant for free has to be
rebuilt by hand, which is exactly what `attacks.validate_placement` is for.

It pays off because the combinations are genuinely wanted. The assignment asks
for the error rate on an ideal line, with noise, with an eavesdropper, and with
both at once; each further question — partial interception, one channel against
another — would otherwise mean writing another class.

DESIGN DECISION — factories, not classes
=========================================
The registry maps a name to a *factory* that accepts the relevant slice of the
configuration, rather than to the class itself.

The reason is that the classes take different parameters, legitimately: the
ideal channel takes none, damping takes a damping parameter or a fibre length,
and a future depolarizing channel would take a probability meaning something
else entirely. A registry of classes would leave the engine to work out which
argument goes where, which is the chain of if/elif the registry exists to
remove.

With factories, that knowledge sits next to the plugin it belongs to. The engine
looks a name up and calls what it finds.
"""

from __future__ import annotations

from collections.abc import Callable

from qkd.actors import Actor, Eavesdropper, Player, Position, Role
from qkd.attacks import Attack, InterceptResend
from qkd.channels import AmplitudeDamping, Channel, IdealChannel
from qkd.settings import (
    AttackConfig,
    AttackerPosition,
    AttackKind,
    ChannelConfig,
    ChannelKind,
)

ChannelFactory = Callable[[ChannelConfig], Channel]
AttackFactory = Callable[[AttackConfig], Attack]

_CHANNELS: dict[str, ChannelFactory] = {}
_ATTACKS: dict[str, AttackFactory] = {}


class UnknownPluginError(KeyError):
    """Raised when a configuration names something that is not registered.

    A dedicated type because this is a configuration error and not a programming
    one: it happens when a preset written for a newer version, or with a typo, is
    loaded by a build that does not have the plugin.
    """


def channel(kind: ChannelKind) -> Callable[[ChannelFactory], ChannelFactory]:
    """Register the factory that builds a channel of `kind`."""

    def decorate(factory: ChannelFactory) -> ChannelFactory:
        _CHANNELS[kind.value] = factory
        return factory

    return decorate


def attack(kind: AttackKind) -> Callable[[AttackFactory], AttackFactory]:
    """Register the factory that builds an attack of `kind`."""

    def decorate(factory: AttackFactory) -> AttackFactory:
        _ATTACKS[kind.value] = factory
        return factory

    return decorate


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


@channel(ChannelKind.IDEAL)
def _build_ideal(config: ChannelConfig) -> Channel:
    return IdealChannel()


@channel(ChannelKind.AMPLITUDE_DAMPING)
def _build_amplitude_damping(config: ChannelConfig) -> Channel:
    """Build from whichever of the two descriptions the configuration carries.

    The configuration guarantees exactly one is present, so no branch here can
    silently pick a default. Which of the two the caller used is preserved: a
    run configured in kilometres reports kilometres.
    """
    if config.gamma is not None:
        return AmplitudeDamping(config.gamma)
    return AmplitudeDamping.from_length(config.length_km)


# ---------------------------------------------------------------------------
# Attacks
# ---------------------------------------------------------------------------


@attack(AttackKind.INTERCEPT_RESEND)
def _build_intercept_resend(config: AttackConfig) -> Attack:
    return InterceptResend(config.fraction)


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------


def build_channel(config: ChannelConfig) -> Channel:
    """Instantiate the channel a configuration asks for.

    Raises:
        UnknownPluginError: if no factory is registered for that kind.
    """
    try:
        factory = _CHANNELS[config.kind.value]
    except KeyError:
        raise UnknownPluginError(
            f"no channel registered under {config.kind.value!r}; "
            f"available: {', '.join(sorted(_CHANNELS))}"
        ) from None
    return factory(config)


def build_attack(config: AttackConfig) -> Attack | None:
    """Instantiate the attack a configuration asks for, if any.

    Returns None when the configuration asks for no attack, so that callers can
    treat "nobody is listening" uniformly instead of special-casing it.

    Raises:
        UnknownPluginError: if no factory is registered for that kind.
    """
    if config.kind is AttackKind.NONE:
        return None
    try:
        factory = _ATTACKS[config.kind.value]
    except KeyError:
        raise UnknownPluginError(
            f"no attack registered under {config.kind.value!r}; "
            f"available: {', '.join(sorted(_ATTACKS))}"
        ) from None
    return factory(config)


def build_eavesdropper(config: AttackConfig) -> Actor | None:
    """Build the actor that performs the configured attack, if any.

    Returns an actor rather than a bare attack because that is what the
    protocols take: the position comes from the actor, the valid positions from
    the attack, and validation joins the two. An attack is not dangerous in the
    abstract — it is dangerous *from somewhere*.

    The placement is deliberately NOT validated here. This function builds what
    was asked for, including a combination that cannot work; refusing it is the
    protocol's job, at the moment it would be performed. Keeping construction
    and validation apart is what allows a test to build an illegal placement and
    check that the framework rejects it.
    """
    built = build_attack(config)
    if built is None:
        return None

    if config.position is AttackerPosition.CHANNEL:
        return Eavesdropper(capabilities=[built])

    # An attacker at an endpoint is a compromised participant, not an outsider:
    # a Player holding an attack, which is how the insider threat is modelled.
    return Player("Compromised endpoint", Role.RECEIVER, capabilities=[built])


# ---------------------------------------------------------------------------
# Introspection
# ---------------------------------------------------------------------------


def available_channels() -> list[str]:
    """Names of every registered channel."""
    return sorted(_CHANNELS)


def available_attacks() -> dict[str, list[str]]:
    """Registered attacks, each with the positions it may be performed from.

    This is what the API exposes so that an interface can offer only the legal
    combinations, rather than letting someone assemble an impossible run and
    discover it when it fails. The threat model reaches the user through this
    dictionary.
    """
    described = {}
    for name, factory in _ATTACKS.items():
        instance = factory(AttackConfig(kind=AttackKind(name)))
        described[name] = sorted(p.value for p in instance.valid_positions)
    return described


def describe() -> dict[str, object]:
    """Everything registered, in a JSON-serialisable form.

    Intended for the plugins endpoint: a client discovers what this build can do
    without having it hard-coded on the other side.
    """
    return {
        "channels": available_channels(),
        "attacks": available_attacks(),
        "positions": sorted(p.value for p in Position),
    }
