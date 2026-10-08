"""Configuration of a simulation run, and the policy applied to its results.

DESIGN DECISIONS
================

1. Configuration is data, not objects
--------------------------------------
These models describe *what to run*, not the objects that run it. A channel
config carries a name and a parameter; it does not carry a Channel. Building the
objects is the registry's job, and keeping the two apart is what lets a
configuration be written, saved, sent over HTTP and read back without ever
touching the simulation code.

It also means the models can be validated before anything is constructed, so an
impossible run is refused while it is still a piece of JSON.

2. Policy lives here, measurement does not
-------------------------------------------
The metrics module computes numbers and refuses to judge them. The thresholds
that turn a number into a decision — the QBER limit, the confidence margin on
the Bell parameter — are policy, and policy is configuration.

The predicates that apply them sit on the policy object rather than in the
engine. The engine asks whether a result is acceptable; it does not know what
acceptable means. That keeps the rule next to the numbers it uses, and makes it
testable without running a simulation.

3. Mutually exclusive parameters are rejected, not silently resolved
---------------------------------------------------------------------
A damping channel can be described by its damping parameter or by a fibre
length, never by both and never by neither. Rather than picking one when both
are given, the model refuses the input and says so. A configuration that
silently ignores half of what it was told is worse than one that fails.

4. Enumerations rather than free strings
-----------------------------------------
Protocol, channel and attack are chosen from closed sets. This is what allows
the exported JSON Schema to describe them as enumerations, so that an interface
built from the schema offers the legal choices instead of a text field that can
be filled with anything.
"""

from __future__ import annotations

import json
import math
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProtocolKind(str, Enum):
    """Which protocol to run."""

    BB84 = "bb84"
    E91 = "e91"


class ChannelKind(str, Enum):
    """What the qubit goes through in transit."""

    IDEAL = "ideal"
    AMPLITUDE_DAMPING = "amplitude_damping"


class AttackKind(str, Enum):
    """Which attack, if any, is performed on the run."""

    NONE = "none"
    INTERCEPT_RESEND = "intercept_resend"
    COMPROMISED_RELAY = "compromised_relay"


class AttackerPosition(str, Enum):
    """Where the attacker stands.

    Mirrors the enumeration in the actor model. It is exposed in the
    configuration on purpose: asking for an attack from an impossible position
    has to be expressible, so that the framework can refuse it. A threat model
    that cannot state the illegal case cannot rule it out either.
    """

    ENDPOINT = "endpoint"
    CHANNEL = "channel"
    RELAY = "relay"


class TopologyKind(str, Enum):
    """The shape of the network a key has to cross.

    CHAIN is the single route: source, a line of relays, target. It is the
    reference case, and the one deployed in practice.

    FAN is the star of parallel routes the split strategy needs — the source
    negotiates with several neighbours at once and each neighbour forwards along
    a line of its own to the target. The important property is not the picture
    but that the routes share no intermediate node, which is what makes holding
    one of them worth nothing.
    """

    CHAIN = "chain"
    FAN = "fan"


class StrategyKind(str, Enum):
    """How the key is carried across the network.

    RELAY_CHAIN forwards the whole key hop by hop, each hop re-encrypting it
    under its own locally established key. Every relay holds the complete key
    for as long as it takes to pass it on.

    SPLIT_PATHS splits the key into one fragment per route, relays each fragment
    along its own route, and recombines them at the target. No relay ever sees
    more than its own fragment, and a fragment on its own is independent of the
    key.
    """

    RELAY_CHAIN = "relay_chain"
    SPLIT_PATHS = "split_paths"


class ChannelConfig(BaseModel):
    """How the transmission line behaves."""

    model_config = ConfigDict(extra="forbid")

    kind: ChannelKind = Field(
        default=ChannelKind.IDEAL,
        description="Ideal means lossless and noiseless, not the absence of a line.",
    )
    gamma: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Damping parameter: probability that an excited state decays.",
    )
    length_km: float | None = Field(
        default=None,
        ge=0.0,
        description="Fibre length. An alternative to gamma, related by "
        "gamma = 1 - exp(-L/L0).",
    )

    @model_validator(mode="after")
    def _exactly_one_parameter(self) -> ChannelConfig:
        if self.kind is ChannelKind.IDEAL:
            if self.gamma is not None or self.length_km is not None:
                raise ValueError(
                    "an ideal channel takes no parameters; "
                    "remove gamma and length_km, or choose amplitude_damping"
                )
            return self

        given = [p for p in (self.gamma, self.length_km) if p is not None]
        if len(given) != 1:
            raise ValueError(
                "amplitude damping needs exactly one of gamma or length_km — "
                "they describe the same channel, so giving both would mean "
                "silently ignoring one"
            )
        return self


class AttackConfig(BaseModel):
    """Whether anyone is listening, and from where."""

    model_config = ConfigDict(extra="forbid")

    kind: AttackKind = Field(default=AttackKind.NONE)
    position: AttackerPosition = Field(
        default=AttackerPosition.CHANNEL,
        description="Validated against the attack's own declared valid positions.",
    )
    fraction: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Share of qubits the attacker touches. Below 1 the induced "
        "error falls proportionally, which is how an adversary trades "
        "information for invisibility.",
    )

    @model_validator(mode="after")
    def _no_parameters_without_an_attack(self) -> AttackConfig:
        if self.kind is AttackKind.NONE and self.fraction != 1.0:
            raise ValueError(
                "fraction has no meaning without an attack; "
                "choose an attack kind or leave fraction at its default"
            )
        return self

    @model_validator(mode="after")
    def _relay_position_matches_relay_attack(self) -> AttackConfig:
        """Keep the relay position and the relay attack tied to each other.

        The pairing is one-to-one in both directions, and both halves are worth
        refusing. A relay attack placed on the channel or at an endpoint is the
        case `attacks.validate_placement` already rejects, caught here while the
        run is still a piece of JSON. The reverse — some other attack declared
        at a relay — would be a configuration that reads as if a relay were
        being attacked while something else entirely runs, and a configuration
        that silently means something other than what it says is the failure
        this module exists to prevent.
        """
        at_relay = self.position is AttackerPosition.RELAY
        is_relay_attack = self.kind is AttackKind.COMPROMISED_RELAY

        if is_relay_attack and not at_relay:
            raise ValueError(
                "compromised_relay is defined at a relay; it cannot be performed "
                f"from {self.position.value}. A relay already holds the key in "
                "the clear, which is what distinguishes it from an attack on the line"
            )
        if at_relay and not is_relay_attack:
            raise ValueError(
                f"{self.kind.value} is not an attack on a relay; "
                "choose compromised_relay, or move the attacker to the channel"
            )
        if is_relay_attack and self.fraction != 1.0:
            raise ValueError(
                "fraction has no meaning for compromised_relay: a relay reads the "
                "whole key it forwards, it does not sample qubits in flight"
            )
        return self


class SecurityPolicy(BaseModel):
    """The thresholds that turn a measurement into accept or discard.

    These are assumptions, not measurements, and the distinction matters when
    reporting results: the simulation produces the numbers, the policy decides
    what to do with them.
    """

    model_config = ConfigDict(extra="forbid")

    qber_threshold: float = Field(
        default=0.11,
        ge=0.0,
        le=0.5,
        description="Above this the key is discarded. The usual figure for BB84 "
        "under one-way post-processing; it depends on the assumptions made about "
        "the adversary and the reconciliation, and has to be stated with them.",
    )
    chsh_confidence: int = Field(
        default=3,
        ge=1,
        le=6,
        description="How many standard deviations above the classical bound of 2 "
        "a Bell violation must sit before it is declared.",
    )

    def accepts_qber(self, qber: float) -> bool:
        """Whether an observed error rate is low enough to keep the key.

        A plain comparison, because the QBER estimate is compared against a
        bound that already accounts for the worst case: every discrepancy is
        attributed to an eavesdropper, including the ones known to be noise.
        """
        return qber <= self.qber_threshold

    def accepts_chsh(self, s: float, uncertainty: float) -> bool:
        """Whether a Bell parameter clears the bound by enough to be believed.

        Not a bare comparison against 2. S is estimated on a finite sample and
        fluctuates around its true value, so a state that is genuinely classical
        can cross the bound by chance. The margin is what stops that from being
        read as a violation.

        The two errors are not symmetric in their consequences: a false negative
        costs time, because an honest key is discarded, while a false positive
        costs the key itself, because one the adversary knows is accepted. Hence
        a margin of several standard deviations rather than none.
        """
        return abs(s) > 2.0 + self.chsh_confidence * uncertainty

    def pairs_needed_for(self, true_s: float) -> int:
        """Pairs per setting combination needed to declare a violation at `true_s`.

        Follows from requiring |S| - 2 > k * sigma with sigma <= 2/sqrt(n):

            n > (2k / (|S| - 2))**2

        The cost grows sharply as the true value approaches the classical bound:
        an ideal 2*sqrt(2) needs a few dozen pairs, whereas a noise-degraded 2.1
        needs thousands. This is why, in a noisy run, a violation stops being
        declarable well before S actually reaches 2.

        Raises:
            ValueError: if `true_s` does not exceed the classical bound, in which
                case no sample size suffices.
        """
        margin = abs(true_s) - 2.0
        if margin <= 0:
            raise ValueError(
                f"|S| = {abs(true_s)} does not exceed the classical bound; "
                "no sample size can certify a violation that is not there"
            )
        return math.ceil((2 * self.chsh_confidence / margin) ** 2)


class SimulationConfig(BaseModel):
    """A complete, self-contained description of one simulation.

    Everything needed to reproduce a result, including the seed. A run whose
    seed is not recorded cannot be repeated, and every figure in the report has
    to be.
    """

    model_config = ConfigDict(extra="forbid")

    protocol: ProtocolKind = Field(default=ProtocolKind.BB84)
    n_qubits: int = Field(
        default=1000,
        ge=1,
        description="Qubits transmitted, or entangled pairs emitted. Roughly half "
        "survive sifting in BB84 and about two ninths in E91.",
    )
    trials: int = Field(
        default=1,
        ge=1,
        description="Independent repetitions of the whole run, for averaging.",
    )
    seed: int = Field(
        default=0,
        ge=0,
        description="Required rather than optional: reproducibility is a property "
        "of the run, not an afterthought.",
    )
    channel: ChannelConfig = Field(default_factory=ChannelConfig)
    attack: AttackConfig = Field(default_factory=AttackConfig)
    security: SecurityPolicy = Field(default_factory=SecurityPolicy)

    @model_validator(mode="after")
    def _no_relay_attack_without_a_relay(self) -> SimulationConfig:
        """Refuse a relay attack on a run that has no relay.

        This configuration describes one hop between two parties. There is no
        third node in it, so a relay cannot be compromised — not because it
        would be hard to simulate, but because the thing being attacked does not
        exist in this run.

        Saying so here rather than letting the run proceed matters: the attack
        touches no qubit, so a run configured this way would complete happily,
        report an untouched QBER and an accepted key, and look like evidence
        that owning a relay costs the adversary nothing to no effect. It would
        be the right number attached to the wrong claim.
        """
        if self.attack.kind is AttackKind.COMPROMISED_RELAY:
            raise ValueError(
                "compromised_relay needs a relay to compromise, and a "
                "point-to-point run has none. Describe the route with a "
                "NetworkSimulationConfig and name the compromised nodes there"
            )
        return self

    def save(self, path: str | Path) -> None:
        """Write this configuration as a JSON preset."""
        Path(path).write_text(self.model_dump_json(indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> SimulationConfig:
        """Read a preset back, validating it in the process.

        Loading is not merely parsing: a file edited by hand, or produced by an
        older version, is checked against the same rules as one built in code.

        Raises:
            pydantic.ValidationError: if the file does not describe a valid run.
        """
        return cls.model_validate_json(Path(path).read_text(encoding="utf-8"))


class NetworkConfig(BaseModel):
    """The route a key has to cross, and who along it has been compromised.

    DESIGN DECISION — the hop length is configured, the total is derived
    ---------------------------------------------------------------------
    A route is described by how long one hop is and how many of them there are,
    never by a total distance to be divided up. The hop length is the physical
    quantity: it is what the channel sees and what decides whether that hop
    produces a key at all. The end-to-end distance is a consequence, and
    deriving it keeps the two from ever disagreeing.

    It also states the thesis of the extension in the shape of the
    configuration. Distance stops being a single number that the protocol either
    survives or does not, and becomes a number of short hops each of which the
    protocol comfortably survives — at the price of every junction between them
    being a node that has to be trusted.
    """

    model_config = ConfigDict(extra="forbid")

    topology: TopologyKind = Field(default=TopologyKind.CHAIN)
    strategy: StrategyKind = Field(default=StrategyKind.RELAY_CHAIN)
    hop_length_km: float = Field(
        default=4.0,
        gt=0.0,
        description="Length of a single hop. The whole point is that this stays "
        "short enough for the protocol to work, however long the route gets. "
        "Under this build's damping channel and the default QBER threshold, a "
        "hop stops producing a key somewhere around 7 km, so the default leaves "
        "margin below that rather than sitting on the edge of it.",
    )
    relays: int = Field(
        default=2,
        ge=0,
        description="Intermediate nodes on each route. A route with n relays has "
        "n + 1 hops, so the end-to-end distance is (n + 1) * hop_length_km.",
    )
    paths: int = Field(
        default=1,
        ge=1,
        description="Parallel routes between source and target. They share no "
        "intermediate node, which is the assumption the split strategy rests on.",
    )
    threshold: int | None = Field(
        default=None,
        ge=1,
        description="Fragments needed to reconstruct the key. Defaults to all of "
        "them, the all-or-nothing case: maximum secrecy, minimum availability.",
    )
    compromised: list[str] | None = Field(
        default=None,
        description="Relays the adversary owns, named. For a specific scenario.",
    )
    compromised_count: int | None = Field(
        default=None,
        ge=0,
        description="How many relays the adversary owns, drawn at random instead "
        "of named. For a curve against the size of the compromise.",
    )
    attack_draws: int = Field(
        default=1,
        ge=1,
        le=1000,
        description="How many random compromises to average leakage over. Costs "
        "nothing in simulation time: the quantum part does not depend on it.",
    )

    @model_validator(mode="after")
    def _topology_supports_the_paths(self) -> NetworkConfig:
        if self.topology is TopologyKind.CHAIN and self.paths != 1:
            raise ValueError(
                "a chain is a single route; asking for "
                f"{self.paths} of them describes a fan, so choose that topology"
            )
        if self.topology is TopologyKind.FAN and self.paths < 2:
            raise ValueError(
                "a fan with one route is a chain under another name; "
                "ask for at least two paths or choose the chain topology"
            )
        return self

    @model_validator(mode="after")
    def _strategy_fits_the_topology(self) -> NetworkConfig:
        """Refuse a split that has nothing to split across.

        Running the split strategy over a single route would produce one
        fragment, which is the key itself, relayed by nodes that each see all of
        it. It would report as a split while behaving as a chain — the same
        numbers as the baseline, under the label of the thing being compared
        against it. That is the one error in this module that would quietly
        invalidate a result instead of stopping a run.
        """
        if self.strategy is StrategyKind.SPLIT_PATHS and self.paths < 2:
            raise ValueError(
                "split_paths needs at least two disjoint routes to split across; "
                "with one route every fragment travels through the same relays "
                "and the split buys nothing"
            )
        return self

    @model_validator(mode="after")
    def _threshold_within_the_fragments(self) -> NetworkConfig:
        """Accept only the threshold the implemented split actually realises.

        The fragmentation here is an all-or-nothing split built from exclusive
        or: the fragments are uniform, independent of the key, and reconstruct
        it only as a complete set. A threshold below the number of fragments
        describes a different construction — threshold secret sharing — which is
        not implemented.

        Refusing it is the honest option. Accepting the field and ignoring it
        would report a run as k-of-n while every fragment remained necessary,
        and the availability half of the trade-off would be measured wrong in
        the direction that flatters the design.
        """
        if self.threshold is None:
            return self
        if self.threshold > self.paths:
            raise ValueError(
                f"a threshold of {self.threshold} cannot be met by {self.paths} "
                "fragments; the key would never be reconstructable"
            )
        if self.threshold != self.paths:
            raise ValueError(
                f"only an all-or-nothing split is implemented, so the threshold "
                f"must equal the number of fragments ({self.paths}); a genuine "
                f"{self.threshold}-of-{self.paths} split needs threshold secret "
                "sharing, which this build does not provide. Leave threshold unset"
            )
        return self

    @model_validator(mode="after")
    def _at_most_one_description_of_the_compromise(self) -> NetworkConfig:
        """Named relays or a count, never both.

        Same rule, and for the same reason, as the two descriptions of the
        damping channel: they describe one thing, so accepting both would mean
        silently ignoring one of them.
        """
        given = [c for c in (self.compromised, self.compromised_count) if c is not None]
        if len(given) > 1:
            raise ValueError(
                "name the compromised relays or give how many, not both — "
                "they describe the same compromise"
            )
        if self.compromised is not None and len(set(self.compromised)) != len(
            self.compromised
        ):
            raise ValueError("the same relay is named twice in compromised")
        if self.compromised_count is None and self.attack_draws != 1:
            raise ValueError(
                "attack_draws averages over random compromises; it has no meaning "
                "when the compromised relays are named, since that scenario is fixed"
            )
        return self

    @property
    def hops_per_path(self) -> int:
        """Hops on one route: one more than the relays it passes through."""
        return self.relays + 1

    @property
    def total_length_km(self) -> float:
        """End-to-end distance along one route, derived and never configured."""
        return self.hops_per_path * self.hop_length_km

    @property
    def effective_threshold(self) -> int:
        """Fragments needed, with the all-or-nothing default made explicit."""
        if self.strategy is StrategyKind.RELAY_CHAIN:
            return 1
        return self.threshold if self.threshold is not None else self.paths


class NetworkSimulationConfig(BaseModel):
    """A complete description of one multi-hop run.

    DESIGN DECISION — composition with SimulationConfig, not inheritance
    ---------------------------------------------------------------------
    This model deliberately does not extend `SimulationConfig` and does not
    contain one. It shares most of its fields, which is exactly why inheriting
    would be wrong: the one field it must not have is `channel`. A hop's channel
    is not a free choice here, it is the hop length under the damping model, and
    a configuration carrying both a channel and a hop length would be able to
    state two different lines for the same fibre.

    What it does instead is describe the run, and let the network layer derive
    one `SimulationConfig` per hop from it. The per-hop configurations are then
    ordinary ones, run by the ordinary engine — which is the property that keeps
    the protocol code untouched by any of this.
    """

    model_config = ConfigDict(extra="forbid")

    protocol: ProtocolKind = Field(default=ProtocolKind.BB84)
    n_qubits: int = Field(
        default=1000,
        ge=1,
        description="Qubits per hop, not per route. Every hop runs the protocol.",
    )
    trials: int = Field(default=1, ge=1)
    seed: int = Field(
        default=0,
        ge=0,
        description="Seeds every hop and every random compromise, derived so that "
        "hops stay independent while the whole run stays reproducible.",
    )
    network: NetworkConfig = Field(default_factory=NetworkConfig)
    attack: AttackConfig = Field(
        default_factory=AttackConfig,
        description="An attack on the hops themselves, independent of which "
        "relays are compromised. Applied identically to every hop.",
    )
    security: SecurityPolicy = Field(default_factory=SecurityPolicy)

    @model_validator(mode="after")
    def _relay_compromise_is_not_a_hop_attack(self) -> NetworkSimulationConfig:
        """Keep the two threat models in the field each belongs to.

        A compromised relay is not something that happens on a hop, so it is not
        described here: it is named in the network configuration, where the
        nodes are. Accepting it in both places would let a run declare two
        different compromises and leave the question of which one applied.
        """
        if self.attack.kind is AttackKind.COMPROMISED_RELAY:
            raise ValueError(
                "a compromised relay belongs to the route, not to a hop; "
                "name it in network.compromised or give network.compromised_count"
            )
        return self

    def save(self, path: str | Path) -> None:
        """Write this configuration as a JSON preset."""
        Path(path).write_text(self.model_dump_json(indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> NetworkSimulationConfig:
        """Read a preset back, validating it in the process."""
        return cls.model_validate_json(Path(path).read_text(encoding="utf-8"))


def json_schema() -> dict:
    """The JSON Schema of a simulation configuration.

    Produced from the models themselves rather than written by hand, so it
    cannot drift away from what the code accepts. The interface builds its form
    from this: enumerations become closed lists of choices, bounds become input
    limits, and the field descriptions become the help text.
    """
    return SimulationConfig.model_json_schema()


def network_json_schema() -> dict:
    """The JSON Schema of a multi-hop configuration.

    A second schema rather than a branch inside the first, because the two
    describe different runs: a form built from this one offers a route and a
    strategy, and does not offer a channel, which in a multi-hop run is not the
    operator's to choose.
    """
    return NetworkSimulationConfig.model_json_schema()


def write_json_schema(path: str | Path) -> None:
    """Export the schema to a file, for the frontend build to consume."""
    Path(path).write_text(json.dumps(json_schema(), indent=2), encoding="utf-8")
