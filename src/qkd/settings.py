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


class AttackerPosition(str, Enum):
    """Where the attacker stands.

    Mirrors the enumeration in the actor model. It is exposed in the
    configuration on purpose: asking for an attack from an impossible position
    has to be expressible, so that the framework can refuse it. A threat model
    that cannot state the illegal case cannot rule it out either.
    """

    ENDPOINT = "endpoint"
    CHANNEL = "channel"


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


def json_schema() -> dict:
    """The JSON Schema of a simulation configuration.

    Produced from the models themselves rather than written by hand, so it
    cannot drift away from what the code accepts. The interface builds its form
    from this: enumerations become closed lists of choices, bounds become input
    limits, and the field descriptions become the help text.
    """
    return SimulationConfig.model_json_schema()


def write_json_schema(path: str | Path) -> None:
    """Export the schema to a file, for the frontend build to consume."""
    Path(path).write_text(json.dumps(json_schema(), indent=2), encoding="utf-8")
