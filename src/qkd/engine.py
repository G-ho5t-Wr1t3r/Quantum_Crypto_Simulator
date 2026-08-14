"""Simulation engine: runs a configuration and aggregates what comes out.

This is the headless core. It composes a run from a configuration, executes the
requested number of trials, and reports results that are JSON-serialisable —
without knowing anything about HTTP, plots or interfaces. Everything the
assignment asks for can be reproduced from here alone.

DESIGN DECISIONS
================

1. The engine composes, it does not decide
-------------------------------------------
It looks plugins up in the registry, runs the protocol, computes the metrics and
asks the configured policy whether the outcome is acceptable. It does not know
what a threshold is, nor which channel is which. Adding a channel changes the
registry; adding a protocol changes the dispatch below; nothing else moves.

2. Per-trial events rather than a final report only
----------------------------------------------------
`run` returns an aggregate, but `stream` yields one event per trial as it
happens. The two share the same code path: the aggregate is built by consuming
the stream, so a live view and a batch result can never disagree.

The reason is not presentation. A run of a thousand qubits in density-matrix
mode takes time, and a progress figure that appears only at the end is a figure
nobody watches. The event schema is also the contract the realtime layer will
publish, so it is fixed here rather than invented later.

3. Aggregates carry their own uncertainty
------------------------------------------
Every averaged quantity is reported with the spread across trials. A mean
without a spread invites the reader to believe the last digit, and with a
handful of trials over a stochastic protocol that digit is noise.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from enum import Enum

from qkd import bb84, e91
from qkd.attacks import validate_placement
from qkd.metrics import chsh_S, chsh_uncertainty, qber, sifting_ratio
from qkd.registry import build_channel, build_eavesdropper
from qkd.settings import ProtocolKind, SimulationConfig


class EventKind(str, Enum):
    """What a streamed event reports.

    Fixed here because this is the vocabulary the realtime layer will publish;
    inventing it at the transport level would put protocol knowledge in the
    wrong place.
    """

    STARTED = "started"
    TRIAL = "trial"
    DONE = "done"
    SWEEP_POINT = "sweep_point"


@dataclass(frozen=True)
class SimulationEvent:
    """One thing that happened during a run.

    Attributes:
        kind: what this event reports.
        index: which trial, counting from zero. None for run-level events.
        payload: the numbers, already JSON-serialisable.
    """

    kind: EventKind
    index: int | None = None
    payload: dict = field(default_factory=dict)


@dataclass(frozen=True)
class TrialResult:
    """What one execution of the protocol produced.

    `chsh` and `chsh_sigma` stay None for BB84, which has no entangled pair and
    therefore no Bell parameter — the absence is meaningful and is preserved
    rather than filled with a zero that would look like a measurement.
    """

    qber: float
    sifting_ratio: float
    n_sifted: int
    chsh: float | None = None
    chsh_sigma: float | None = None
    qber_by_basis: dict[str, float] | None = None
    eavesdropper_knowledge: float | None = None
    # Per-participant records, position by position. None on trials past the
    # first: they are large, and an interface only ever animates one.
    #
    # The protocol phases are NOT streamed as separate events. A trial runs
    # synchronously and its qubits are simulated one at a time in density-matrix
    # mode, so emitting an event per qubit would flood the channel with more
    # traffic than physics. The interface replays preparation, transit, sifting
    # and estimation from these views instead, which gives the same animation
    # under its own control of pacing. Streaming them for real would mean
    # turning the protocols into generators — deferred, and not needed for it.
    views: dict | None = None

    def as_dict(self) -> dict:
        return {
            "qber": self.qber,
            "sifting_ratio": self.sifting_ratio,
            "n_sifted": self.n_sifted,
            "chsh": self.chsh,
            "chsh_sigma": self.chsh_sigma,
            "qber_by_basis": self.qber_by_basis,
            "eavesdropper_knowledge": self.eavesdropper_knowledge,
            "views": self.views,
        }


@dataclass(frozen=True)
class RunResult:
    """The aggregate over every trial, plus the verdict of the policy."""

    trials: list[TrialResult]
    qber_mean: float
    qber_stdev: float
    chsh_mean: float | None
    chsh_stdev: float | None
    accepted: bool
    reason: str

    def as_dict(self) -> dict:
        return {
            "trials": [t.as_dict() for t in self.trials],
            "qber_mean": self.qber_mean,
            "qber_stdev": self.qber_stdev,
            "chsh_mean": self.chsh_mean,
            "chsh_stdev": self.chsh_stdev,
            "accepted": self.accepted,
            "reason": self.reason,
        }


def _run_bb84(config: SimulationConfig, seed: int, channel, eavesdropper) -> TrialResult:
    result = bb84.run(
        config.n_qubits, seed, channel=channel, eavesdropper=eavesdropper
    )
    by_basis = {}
    for basis, label in ((0, "rectilinear"), (1, "diagonal")):
        alice, bob = result.sifted_in_basis(basis)
        # A basis can come up empty on a short run; reporting None says "not
        # measured" rather than "measured zero".
        by_basis[label] = qber(alice, bob) if alice else None

    return TrialResult(
        qber=qber(result.alice_sifted, result.bob_sifted),
        sifting_ratio=sifting_ratio(len(result.alice_sifted), config.n_qubits),
        n_sifted=len(result.alice_sifted),
        qber_by_basis=by_basis,
        eavesdropper_knowledge=result.eavesdropper_knowledge(),
        views=result.views(),
    )


def _run_e91(config: SimulationConfig, seed: int, channel, eavesdropper) -> TrialResult:
    result = e91.run(config.n_qubits, seed, channel=channel, eavesdropper=eavesdropper)
    s = chsh_S(
        *e91.chsh_correlators(
            result.alice_angles,
            result.bob_angles,
            result.alice_outcomes,
            result.bob_outcomes,
        )
    )
    # Each of the nine angle combinations occurs about one ninth of the time, and
    # the uncertainty is driven by the smallest group.
    per_setting = max(1, config.n_qubits // 9)

    return TrialResult(
        qber=qber(result.alice_sifted, result.bob_sifted),
        sifting_ratio=sifting_ratio(len(result.alice_sifted), config.n_qubits),
        n_sifted=len(result.alice_sifted),
        chsh=s,
        chsh_sigma=chsh_uncertainty(per_setting),
        views=result.views(),
    )


_PROTOCOLS = {
    ProtocolKind.BB84: _run_bb84,
    ProtocolKind.E91: _run_e91,
}


def stream(config: SimulationConfig) -> Iterator[SimulationEvent]:
    """Execute the configuration, yielding an event per trial as it completes.

    The placement of any attacker is validated before the first trial: a run
    that cannot be performed fails immediately rather than after minutes of
    computation.

    Each trial uses a seed derived from the configured one, so the whole run is
    reproducible while the trials remain independent — reusing a single seed
    would produce identical trials and a spread of exactly zero.

    Raises:
        AttackNotAllowedError: if the attacker cannot act from its position.
        UnknownPluginError: if the configuration names something unregistered.
    """
    channel = build_channel(config.channel)
    eavesdropper = build_eavesdropper(config.attack)

    if eavesdropper is not None:
        for capability in eavesdropper.capabilities:
            validate_placement(capability, eavesdropper.position)

    execute = _PROTOCOLS[config.protocol]

    yield SimulationEvent(
        kind=EventKind.STARTED,
        payload={
            "protocol": config.protocol.value,
            "channel": config.channel.kind.value,
            "attack": config.attack.kind.value,
            "trials": config.trials,
            "n_qubits": config.n_qubits,
        },
    )

    results: list[TrialResult] = []
    for index in range(config.trials):
        trial = execute(config, config.seed + index, channel, eavesdropper)
        # Views are kept on the first trial only: they are proportional to
        # n_qubits, and an interface animates one run rather than all of them.
        if index > 0:
            trial = replace(trial, views=None)
        results.append(trial)
        yield SimulationEvent(kind=EventKind.TRIAL, index=index, payload=trial.as_dict())

    yield SimulationEvent(
        kind=EventKind.DONE, payload=_aggregate(config, results).as_dict()
    )


def run(config: SimulationConfig) -> RunResult:
    """Execute the configuration and return the aggregate.

    Consumes the same stream the realtime layer publishes, so a batch result and
    a live view are built from identical numbers by construction.
    """
    last = None
    for event in stream(config):
        if event.kind is EventKind.DONE:
            last = event
    assert last is not None
    return _rebuild(last.payload)


class SweepAxis(str, Enum):
    """Which parameter a sweep varies.

    Closed set rather than a free path into the configuration: a sweep over an
    arbitrary field would be more general and would also allow varying the seed,
    which produces a curve of pure noise that looks like a result.
    """

    GAMMA = "gamma"
    LENGTH_KM = "length_km"
    ATTACK_FRACTION = "attack_fraction"


def _with_axis(config: SimulationConfig, axis: SweepAxis, value: float) -> SimulationConfig:
    """A copy of `config` with one parameter moved to `value`."""
    data = config.model_dump()
    if axis is SweepAxis.GAMMA:
        data["channel"] = {"kind": "amplitude_damping", "gamma": value, "length_km": None}
    elif axis is SweepAxis.LENGTH_KM:
        data["channel"] = {"kind": "amplitude_damping", "gamma": None, "length_km": value}
    else:
        data["attack"] = {**data["attack"], "kind": "intercept_resend", "fraction": value}
    return SimulationConfig.model_validate(data)


def sweep_stream(
    config: SimulationConfig,
    axis: SweepAxis,
    values: list[float],
) -> Iterator[SimulationEvent]:
    """Run the configuration once per value, yielding a point as each lands.

    This is the mode that produces the figures. A single run answers "what
    happened"; a sweep answers "how does it behave", and the assignment's
    results — the error rate against the damping parameter, against the
    intercepted fraction, the Bell parameter degrading with noise — are all
    curves rather than numbers.

    Points are streamed because each one is a complete run: in density-matrix
    mode a sweep of twenty points is twenty simulations, and a progress bar that
    only fills at the end is a progress bar nobody watches.

    The views are stripped from sweep points. They are proportional to the qubit
    count and multiply by the number of points, and nothing in a curve needs
    them.

    Args:
        config: the base configuration; every field except the swept one is held.
        axis: which parameter to vary.
        values: the points to evaluate, in the order they should be plotted.

    Raises:
        ValueError: if no values are given.
    """
    if not values:
        raise ValueError("a sweep needs at least one value")

    yield SimulationEvent(
        kind=EventKind.STARTED,
        payload={"axis": axis.value, "values": list(values), "points": len(values)},
    )

    points = []
    for index, value in enumerate(values):
        result = run(_with_axis(config, axis, value))
        point = {
            "value": value,
            "qber": result.qber_mean,
            "qber_stdev": result.qber_stdev,
            "chsh": result.chsh_mean,
            "chsh_stdev": result.chsh_stdev,
            "accepted": result.accepted,
            # Kept per point because the split by basis is the whole reason the
            # damping curve is worth plotting: the two bases must be separate
            # series, or the asymmetry averages away.
            "qber_by_basis": result.trials[0].qber_by_basis,
            "eavesdropper_knowledge": result.trials[0].eavesdropper_knowledge,
        }
        points.append(point)
        yield SimulationEvent(kind=EventKind.SWEEP_POINT, index=index, payload=point)

    yield SimulationEvent(
        kind=EventKind.DONE, payload={"axis": axis.value, "points": points}
    )


def sweep(config: SimulationConfig, axis: SweepAxis, values: list[float]) -> list[dict]:
    """Run a sweep and return the curve, consuming the same stream."""
    for event in sweep_stream(config, axis, values):
        if event.kind is EventKind.DONE:
            return event.payload["points"]
    return []


def linspace(start: float, stop: float, points: int) -> list[float]:
    """Evenly spaced values, endpoints included.

    Here rather than left to the caller so that a sweep requested over HTTP can
    be described by three numbers instead of a list that has to be built
    client-side and can silently disagree with what the axis allows.
    """
    if points < 2:
        raise ValueError("a sweep needs at least two points")
    step = (stop - start) / (points - 1)
    return [start + step * i for i in range(points)]


def _aggregate(config: SimulationConfig, results: list[TrialResult]) -> RunResult:
    """Average the trials and apply the configured policy.

    The verdict comes from the policy object, not from here: the engine asks
    whether a result is acceptable without knowing what acceptable means.
    """
    qbers = [t.qber for t in results]
    qber_mean = statistics.fmean(qbers)
    qber_stdev = statistics.stdev(qbers) if len(qbers) > 1 else 0.0

    chsh_values = [t.chsh for t in results if t.chsh is not None]
    chsh_mean = statistics.fmean(chsh_values) if chsh_values else None
    chsh_stdev = statistics.stdev(chsh_values) if len(chsh_values) > 1 else (
        0.0 if chsh_values else None
    )

    policy = config.security
    if chsh_mean is not None:
        sigma = results[0].chsh_sigma or 0.0
        accepted = policy.accepts_chsh(chsh_mean, sigma)
        reason = (
            f"S = {chsh_mean:.3f} against a bound of "
            f"{2 + policy.chsh_confidence * sigma:.3f}"
        )
    else:
        accepted = policy.accepts_qber(qber_mean)
        reason = (
            f"QBER = {qber_mean:.4f} against a threshold of {policy.qber_threshold}"
        )

    return RunResult(
        trials=results,
        qber_mean=qber_mean,
        qber_stdev=qber_stdev,
        chsh_mean=chsh_mean,
        chsh_stdev=chsh_stdev,
        accepted=accepted,
        reason=reason,
    )


def _rebuild(payload: dict) -> RunResult:
    """Reconstruct the aggregate from the payload of a done event."""
    return RunResult(
        trials=[TrialResult(**t) for t in payload["trials"]],
        qber_mean=payload["qber_mean"],
        qber_stdev=payload["qber_stdev"],
        chsh_mean=payload["chsh_mean"],
        chsh_stdev=payload["chsh_stdev"],
        accepted=payload["accepted"],
        reason=payload["reason"],
    )
