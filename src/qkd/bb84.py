"""BB84 protocol (Bennett-Brassard 1984), ideal channel.

This module implements the quantum part of the protocol: Alice prepares qubits
from random bits and random bases, Bob measures in his own random bases, and
the two sift by keeping the positions where the bases agree.

Deliberately out of scope here:
  * the channel — added in E1/E2, for now transmission is lossless and noiseless;
  * the attacker — added in F4;
  * error correction and privacy amplification — backlog.

What the protocol assumes but does not implement: the classical channel is
authenticated, using a short pre-shared secret. Without it BB84 is defenceless
against a man-in-the-middle, which is why it is properly called *key growing*
rather than key distribution.

Ordering matters and is a security mechanism, not bookkeeping: Alice announces
her bases only after Bob confirms he has measured. Reversing the two steps
would leave the protocol intact and the security gone.
"""

from dataclasses import dataclass

import numpy as np
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

from qkd.types import Bases, Bits

# One simulator for the whole module: constructing it is not free, and there is
# no per-call state to isolate — reproducibility comes from seed_simulator,
# passed explicitly at every run.
_SIMULATOR = AerSimulator()


@dataclass(frozen=True)
class BB84Run:
    """Everything one run of the protocol produced, before any metric.

    Kept as raw parallel sequences rather than a processed result, so that the
    metrics module and the tests can ask their own questions of the same run.
    All five sequences share the same indexing over transmitted qubits, except
    the sifted ones which are the surviving subset in the original order.
    """

    alice_bits: Bits
    alice_bases: Bases
    bob_bases: Bases
    bob_bits: Bits
    alice_sifted: Bits
    bob_sifted: Bits


def random_bits(n: int, rng: np.random.Generator) -> Bits:
    """Draw n uniformly random bits.

    Takes the generator rather than a seed so that a whole run shares one
    stream: reproducibility is a property of the run, not of each call.
    """
    return rng.integers(0, 2, size=n).tolist()


def prepare(bit: int, basis: int) -> QuantumCircuit:
    """Build the single-qubit circuit encoding `bit` in `basis`.

    ENCODING CONVENTION — fixed here, and the report must use the same words.
    Every later comparison depends on it, and a silent mismatch between this
    function and `measure` produces a nonzero QBER on a perfect channel.

        basis 0 — rectilinear, the computational (Z) basis
            bit 0 -> |0>        (no gate: the qubit already starts there)
            bit 1 -> |1>        (X)

        basis 1 — diagonal, the Hadamard (X) basis
            bit 0 -> |+>        (H)
            bit 1 -> |->        (X, then H)

    The two rows are the same encoding seen in two bases: |+> and |-> are what
    |0> and |1> become under H. That is why `measure` can read basis 1 by
    applying H and then measuring in Z — H is its own inverse, so it undoes the
    preparation and maps |+> back to |0> and |-> back to |1>.

    A bit encoded in one basis and read in the other yields a uniformly random
    outcome. That is not a defect: it is the mechanism that makes eavesdropping
    detectable, and the reason sifting discards roughly half the positions.

    Args:
        bit: the value to encode, 0 or 1.
        basis: the basis to encode it in, 0 or 1.

    Returns:
        A QuantumCircuit on one qubit, prepared and not yet measured.

    Raises:
        ValueError: if `bit` or `basis` is not 0 or 1.
    """
    if bit not in (0, 1):
        raise ValueError(f"Bit must be 0 or 1, got {bit}")
    if basis not in (0, 1):
        raise ValueError(f"Basis must be 0 or 1, got {basis}")

    qc = QuantumCircuit(1)      # already in |0⟩

    match (bit, basis):
        case (0, 0):
            pass
        case (1, 0):
            qc.x(0)
        case (0, 1):
            qc.h(0)
        case (1, 1):
            qc.x(0)
            qc.h(0)
    return qc


def measure(circuit: QuantumCircuit, basis: int, rng: np.random.Generator) -> int:
    """Measure the qubit in `basis` and return the observed bit.

    Measurement in hardware and in Aer is always in the computational basis;
    reading in another basis means rotating first. Which rotation, and in which
    direction, follows from the convention chosen in `prepare`.

    Args:
        circuit: the prepared single-qubit circuit.
        basis: the basis Bob chose for this position.
        rng: seeded generator, so the run is reproducible.

    Returns:
        The measured bit, 0 or 1.

    Raises:
        ValueError: if `basis` is not 0 or 1.
    """
    if basis not in (0, 1):
        raise ValueError(f"Basis must be 0 or 1, got {basis}")

    qc = circuit.copy()

    if basis == 1:
        qc.h(0)

    qc.measure_all()

    sim_seed = int(rng.integers(0, 2**31))
    counts = _SIMULATOR.run(qc, shots=1, seed_simulator=sim_seed).result().get_counts()
    # shots=1: this simulates a single physical qubit, which travels once and is
    # measured once. More shots would mean measuring several identical copies of
    # an unknown state, which the no-cloning theorem forbids — and if it were
    # possible, Eve could do it too and BB84 would offer no security at all.
    # get_counts() returns a dict like {'bitstring': occurrences}.

    # shots=1, so counts holds exactly one bitstring of length 1: convert the only key in the dict.
    return int(next(iter(counts)))


def sift(
    alice_bits: Bits,
    alice_bases: Bases,
    bob_bits: Bits,
    bob_bases: Bases,
) -> tuple[Bits, Bits]:
    """Keep the positions where Alice and Bob used the same basis.

    Discarding is decided by basis mismatch alone, never by whether the bits
    agree: comparing values here would leak the key and would also destroy the
    meaning of the QBER computed afterwards.

    Returns:
        Alice's and Bob's sifted keys, same length, same order, aligned index
        by index.

    Raises:
        ValueError: if the four inputs do not all have the same length.
    """
    if not (len(alice_bits) == len(alice_bases) == len(bob_bits) == len(bob_bases)):
        raise ValueError("All four sequences must have the same length")

    sifted_alice, sifted_bob = [], []
    for i in range(len(alice_bits)):
        if alice_bases[i] == bob_bases[i]:
            sifted_alice.append(alice_bits[i])
            sifted_bob.append(bob_bits[i])
    return (sifted_alice, sifted_bob)


def run(n_bits: int, seed: int) -> BB84Run:
    """Execute one full ideal-channel run and return everything it produced.

    Seeding is explicit and required rather than optional: a run whose seed is
    not pinned cannot be reproduced, and every figure in the report has to be.

    Args:
        n_bits: how many qubits Alice transmits.
        seed: seed for the run's random stream.

    Returns:
        The complete BB84Run.
    """
    # One generator for the whole run: Alice's bits, Alice's bases, Bob's bases and every
    # simulator seed are drawn from the same stream. Re-deriving a generator from `seed` at
    # each call would make those three sequences identical to one another, and a run in which
    # Bob always happens to guess Alice's basis reports QBER 0 even with an eavesdropper.
    rng = np.random.default_rng(seed)

    # PHASE 1: Alice chooses random bits and random bases, and prepares one qubit for each pair.
    alice_bits = random_bits(n_bits, rng)
    alice_bases = random_bits(n_bits, rng)

    alice_qubits = []
    for bit, base in zip(alice_bits, alice_bases):
        alice_qubit = prepare(bit, base)
        alice_qubits.append(alice_qubit)

    # PHASE 2: Bob receives Alice's qubits and measures each one in a basis he picks at random.
    bob_bases = random_bits(n_bits, rng)
    bob_bits = []
    for qubit, base in zip(alice_qubits, bob_bases):
        bob_bit = measure(qubit, base, rng)
        bob_bits.append(bob_bit)

    # PHASE 3: Only once Bob has measured everything may the bases be announced and the keys
    # sifted. Here the ordering is guaranteed by the sequential execution.
    alice_sifted, bob_sifted = sift(alice_bits, alice_bases, bob_bits, bob_bases)

    # PHASE 4: Both hold a sifted key. They are not necessarily equal yet — establishing that
    # is what the QBER estimate is for.
    execution = BB84Run(
        alice_bits=alice_bits,
        alice_bases=alice_bases,
        alice_sifted=alice_sifted,
        bob_bits=bob_bits,
        bob_bases=bob_bases,
        bob_sifted=bob_sifted
        )
    return execution