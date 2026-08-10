"""Quantum channels: what happens to a qubit while it travels.

DESIGN DECISIONS
================

1. A channel modifies the circuit
-------------------------------
`apply` receives a circuit and inserts the noise into it, rather than producing
an Aer NoiseModel or operating directly on a density matrix.

The reason is *where* the noise acts. In a QKD run the noise is not a property
of a gate, nor of the measuring apparatus: it is what happens to the qubit while
it is in transit, at one precise point between Alice's preparation and Bob's
measurement. Inserting an instruction at that point states exactly that.

The two alternatives were rejected:

  * an Aer `NoiseModel` attaches noise to *gates*, by name and qubit. Nothing in
    transit is a gate, so it would need a dummy gate inserted purely to have
    something to hang the noise on — an artifact with no physical meaning that
    would then have to be explained.
  * a map on density matrices, rho -> sum_i K_i rho K_i^dagger, is the purest
    statement of what a channel is, but it detaches from circuits entirely and
    would mean rewriting how bb84.py and e91.py measure.

The cost of this choice is that any protocol carrying a real channel must be
simulated in `density_matrix` mode: the output of a noisy channel is a mixed
state, which no state vector represents. That cost is not an extra, since the
assignment requires density-matrix simulation anyway.

The benefit worth naming: the Kraus operators stay visible in this project's own
code instead of being hidden inside a library call.

2. Parameters differ, the contract does not
-------------------------------------------
`IdealChannel` takes nothing, `AmplitudeDamping` takes gamma, a future
`Depolarizing` would take a probability with a different meaning. That is
legitimate — they are different physics.

What has to be uniform is the contract: every channel carries a stable
identifier and answers to the same `apply`. This is what lets the registry at H1
discover channels and the engine at H2 compose a run from a configuration
without a chain of if/elif that would need editing for every new channel.
Per-channel parameter validation belongs to the pydantic models at G1, which is
why G1 depends on E1 in the plan.

3. Alternative constructors rather than optional parameters
-----------------------------------------------------------
E3 asks that the same channel be buildable from gamma or from a fibre length.
The way to offer both is a classmethod alongside `__init__`, not one constructor
with two optional arguments: the latter would declare two optional parameters
while in fact requiring exactly one, pushing the error to runtime.

It also keeps the exponential attenuation law in a single named place.

4. `apply` never mutates its argument
--------------------------------------
Channels copy the circuit and return the copy. Qiskit's gate methods work in
place, so without this rule a protocol that builds one circuit and reuses it for
every qubit would see the noise accumulate: each pass would add another layer of
damping, and the QBER would climb with no visible cause. Stating it on the
abstract method makes it a contract every channel inherits, rather than a habit
each one has to remember.
"""

import math
from abc import ABC, abstractmethod

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Kraus

# Attenuation length of standard telecom fibre at 1550 nm, in km.
#
# Manufacturers quote attenuation as alpha = 0.2 dB/km. Converting to the
# exponential form used here, transmission over L km is
#     T(L) = 10^(-alpha*L/10) = exp(-L/L0)    with    L0 = 10/(alpha*ln 10)
# which gives 10/(0.2 * 2.302585) = 21.71 km. Half the photons are lost after
# about 15 km, and that is the whole reason terrestrial QKD links are short.
FIBRE_ATTENUATION_LENGTH_KM = 21.71


class Channel(ABC):
    """What a qubit goes through between preparation and measurement.

    Subclasses declare `name`, which is the identifier a configuration uses to
    ask for this channel and the key the registry will register it under. It has
    to be stable: it ends up in saved presets and in the report.
    """

    name: str

    @abstractmethod
    def apply(self, circuit: QuantumCircuit, qubit: int) -> QuantumCircuit:
        """Insert this channel's effect on `qubit`, at this point in `circuit`.

        Called between preparation and measurement, so the position in the
        instruction list is the position in time. Implementations must not
        assume the qubit is in any particular state: a channel acts on whatever
        arrives.

        NEVER MUTATES ITS ARGUMENT. Implementations copy the circuit, insert
        into the copy, and return that. Qiskit's own gate methods work in place,
        so this has to be stated rather than assumed — and the bug it prevents
        is a nasty one: a protocol builds one circuit and reuses it for every
        qubit, so an in-place channel would let the noise accumulate run after
        run and produce a QBER that climbs for no visible reason.

        Args:
            circuit: the circuit being built. Left untouched.
            qubit: index of the qubit in transit. Channels that act on the whole
                register may ignore it; it exists because E91 carries two arms
                and F6 attacks only one of them.

        Returns:
            A new circuit, with the channel applied.
        """

    def __repr__(self) -> str:
        return f"{type(self).__name__}()"


class IdealChannel(Channel):
    """A lossless, noiseless channel: the qubit arrives as it left.

    Not a placeholder. It is the baseline every noisy result is read against —
    the case in which BB84 must give QBER exactly 0 and E91 must reach
    2*sqrt(2) — and it is what makes "no channel" and "a channel that does
    nothing" the same object rather than a special case scattered through the
    protocols.
    """

    name = "ideal"

    def apply(self, circuit: QuantumCircuit, qubit: int) -> QuantumCircuit:
        """Return an untouched copy: nothing happens in transit.

        The copy is not pointless. It keeps the ideal case honest to the same
        contract as every other channel, so that swapping one for another can
        never change whether the caller's circuit gets mutated.
        """
        return circuit.copy()


class AmplitudeDamping(Channel):
    """Energy loss towards the ground state: the model of loss in a fibre.

    WHY THIS CHANNEL AND NOT ANOTHER
    ---------------------------------
    Amplitude damping describes a system decaying towards |0>: the excited state
    |1> relaxes with probability gamma, while |0> is a fixed point and is left
    alone. That is what physically happens to a photon in a fibre — absorption,
    the same process measured as the T1 relaxation time — and it makes the
    channel **asymmetric** and **non-unital**: it does not preserve the
    maximally mixed state, because it pushes every state towards one pole.

    The alternatives, and why they are worse here:

      * DEPOLARIZING is isotropic and unital. It shrinks the Bloch vector
        towards the centre with no preferred direction, so it would predict the
        same QBER in every basis. Fibre loss has a direction — the ground state
        — and depolarizing erases exactly the signature that distinguishes it.

      * PHASE DAMPING destroys the off-diagonal terms while leaving populations
        untouched. It models decoherence without energy loss, so on its own it
        cannot produce an error at all in the computational basis.

      * A CLASSICAL BIT-FLIP is the worst of the three. It is symmetric, unital,
        and applied to classical bits after measurement it never touches
        coherence, so it is not a quantum channel at all. This is the modelling
        error of the previous thesis work, and correcting it is what this
        project is for.

    THE MEASURABLE CONSEQUENCE
    ---------------------------
    Because the channel is asymmetric, the QBER it produces DEPENDS ON THE BASIS:

        QBER_Z = gamma / 2
        QBER_X = (1 - sqrt(1 - gamma)) / 2  ~ gamma / 4  for small gamma

    In the Z basis |0> is untouched and |1> flips with probability gamma, so
    over uniformly random bits half of them are at risk. In the X basis the
    damping shrinks the coherence by sqrt(1 - gamma) and biases the populations,
    which works out to roughly half the Z error.

    So the Z basis is about TWICE as noisy as the X basis. That prediction is
    the experimental fingerprint of amplitude damping, it is what E4 has to show
    in its curves, and neither depolarizing nor a bit-flip could ever reproduce
    it. A plot in which the two bases coincide means the channel is wrong, not
    the plot.
    """

    name = "amplitude_damping"

    def __init__(self, gamma: float):
        """Build the channel from the damping parameter directly.

        Args:
            gamma: probability that |1> decays to |0>, in [0, 1]. At 0 the
                channel is the identity; at 1 every excited state collapses.

        Raises:
            ValueError: if gamma lies outside [0, 1].
        """
        if not 0.0 <= gamma <= 1.0:
            raise ValueError(f"gamma must lie in [0, 1], got {gamma}")
        self.gamma = gamma

    @classmethod
    def from_length(
        cls,
        length_km: float,
        attenuation_length_km: float = FIBRE_ATTENUATION_LENGTH_KM,
    ) -> "AmplitudeDamping":
        """Build the channel from a physical fibre length (task E3).

        Transmission over a fibre falls exponentially with distance, so the loss
        probability is

            gamma = 1 - exp(-L / L0)

        This is an alternative constructor rather than an optional argument on
        __init__ because exactly one of the two descriptions is required, never
        both, and a signature with two optional parameters would push that error
        to runtime. It also keeps the attenuation law in one named place.

        Args:
            length_km: fibre length in kilometres.
            attenuation_length_km: L0, defaulting to standard telecom fibre.

        Returns:
            The channel with the corresponding gamma.

        Raises:
            ValueError: if either length is negative, or L0 is not positive.
        """
        if length_km < 0:
            raise ValueError(f"length must not be negative, got {length_km}")
        if attenuation_length_km <= 0:
            raise ValueError(
                f"attenuation length must be positive, got {attenuation_length_km}"
            )
        return cls(1.0 - math.exp(-length_km / attenuation_length_km))

    def kraus_operators(self) -> list[np.ndarray]:
        """The two Kraus operators of the channel.

            K0 = [[1, 0], [0, sqrt(1 - gamma)]]     nothing decayed
            K1 = [[0, sqrt(gamma)], [0, 0]]         |1> -> |0>

        K0 leaves |0> alone and shrinks the |1> amplitude; K1 carries the decay
        itself, mapping |1> onto |0> and annihilating |0>. Read the asymmetry
        straight off them: the second column of K1 acts, the first is zero.

        They satisfy the completeness relation sum_i K_i^dagger K_i = I, which
        is what guarantees the map preserves the trace and therefore sends
        density matrices to density matrices. The test asserts it numerically
        rather than trusting the algebra.

        These are the same operators qiskit_aer's amplitude_damping_error builds
        at zero excited-state population; they are written out here so the
        physics stays in this project's code rather than inside a library call.
        """
        return [
            np.array([[1.0, 0.0], [0.0, math.sqrt(1.0 - self.gamma)]]),
            np.array([[0.0, math.sqrt(self.gamma)], [0.0, 0.0]]),
        ]

    def apply(self, circuit: QuantumCircuit, qubit: int) -> QuantumCircuit:
        """Insert the damping on `qubit`, at this point in the circuit.

        The output state is mixed, so a circuit carrying this channel has to be
        simulated with `AerSimulator(method="density_matrix")`. A state vector
        cannot represent the result.
        """
        noisy = circuit.copy()
        noisy.append(Kraus(self.kraus_operators()), [qubit])
        return noisy

    def __repr__(self) -> str:
        return f"AmplitudeDamping(gamma={self.gamma:.4g})"