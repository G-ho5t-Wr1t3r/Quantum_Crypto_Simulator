"""E91 protocol (Ekert 1991), ideal channel.

The structural difference from BB84 is that nobody transmits the key. A source
emits entangled pairs and sends one particle to each party; the key does not
exist until both have measured. There is no state for Eve to intercept in
transit, because none of it carries information yet.

Consequences that shape this module:

  * Alice does not choose bits, only measurement angles. The key emerges from
    the correlations.
  * The measurements split into two disjoint subsets. Matching angles give
    perfectly correlated outcomes and become the key; the four CHSH
    combinations are announced publicly and give S. The Bell test therefore
    costs no key bits, unlike BB84's QBER estimate which burns them.
  * The security check is S, not an error rate, and it fires in the opposite
    direction: BB84 aborts when the QBER climbs above threshold, E91 aborts
    when |S| falls to 2 or below.

Deliberately out of scope: the channel (E1/E2), the attacker (F6), error
correction and privacy amplification (backlog). As in bb84.py, the classical
channel is assumed authenticated.
"""

from dataclasses import dataclass

import math
import numpy as np
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

from qkd.metrics import correlator
from qkd.types import Bits

# Measurement angles on the Bloch sphere, in degrees, in the X-Z plane:
# 0 is the Z direction and 90 is the X direction.
#
# Two of Alice's angles coincide with two of Bob's, and those shared settings
# are what produces the key. The remaining combinations form the CHSH set. The
# overlap is the reason Ekert needs three settings per party: with two each,
# all four combinations would be needed for the Bell test and nothing would be
# left over for the key.
ALICE_ANGLES = (0.0, 45.0, 90.0)
BOB_ANGLES = (45.0, 90.0, 135.0)

# The key comes from the two shared angles.
KEY_ANGLES = (45.0, 90.0)

# The four CHSH combinations, as (alice_angle, bob_angle), in the order the
# terms appear in metrics.chsh_S. The minus sits on the second, which is the
# only pair 135 degrees apart.
CHSH_SETTINGS = (
    (0.0, 45.0),    # e_a1b1
    (0.0, 135.0),   # e_a1b3   <- the subtracted term
    (90.0, 45.0),   # e_a3b1
    (90.0, 135.0),  # e_a3b3
)

# Of the nine possible combinations, four feed the Bell test and two the key,
# so roughly 2/9 of the pairs survive as key material — noticeably less
# generous than BB84's one half.

_SIMULATOR = AerSimulator()


@dataclass(frozen=True)
class E91Run:
    """Everything one run produced, before any metric.

    The first four sequences are indexed by pair, in emission order. The sifted
    ones are the surviving subset, in the original order.
    """

    alice_angles: tuple[float, ...]
    bob_angles: tuple[float, ...]
    alice_outcomes: Bits
    bob_outcomes: Bits
    alice_sifted: Bits
    bob_sifted: Bits


def bell_pair() -> QuantumCircuit:
    """Build the two-qubit circuit preparing the source state.

    The state is |Phi+> = (|00> + |11>)/sqrt(2), produced by a Hadamard on the
    first qubit followed by a CNOT controlled by it — the circuit in Plastina
    part 2, page 10. The Hadamard is not there to randomise anything: it creates
    the superposition that CNOT can turn into entanglement, since CNOT applied
    to a product state leaves it a product state.

    On |Phi+> the correlator is E = +cos(theta_a - theta_b), and outcomes on
    matching angles are EQUAL. Ekert's original paper uses the singlet |Psi->,
    where they are opposite and E carries the other sign; the two states are
    equivalent up to a local unitary, but the sign convention of chsh_S was
    derived for |Phi+> and does not survive the swap.

    Returns:
        A two-qubit circuit, prepared and not yet measured.
    """
    qc = QuantumCircuit(2) # |00⟩
    qc.h(0)
    qc.cx(0, 1)
    return qc


def measure_pair(
    circuit: QuantumCircuit,
    alice_angle: float,
    bob_angle: float,
    rng: np.random.Generator,
) -> tuple[int, int]:
    """Measure both halves at the given angles and return the two bits.

    Measurement is always computational, so reading along a direction means
    rotating that direction onto Z first. Unlike BB84, the angles here are not
    only 0 and 90: 45 and 135 degrees have no standard gate, so a parametric
    rotation about Y is required rather than a Hadamard.

    Mind the sense of the rotation, and mind that a Bloch-sphere angle is not
    automatically the same number a gate parameter expects. Getting either wrong
    produces correlators that look reasonable and an S that is quietly false.

    Verify against these two invariants before trusting anything downstream:

        E(0, 0)  = +1     same angle, perfect correlation on |Phi+>
        E(0, 90) =  0     orthogonal settings, no correlation

    If those two do not come out, the angles or the rotation sense are wrong,
    and no amount of correct CHSH algebra will save the result.

    As in bb84.measure, one pair is measured once: shots stays at 1.

    Args:
        circuit: the prepared Bell pair.
        alice_angle: Alice's measurement angle in degrees.
        bob_angle: Bob's measurement angle in degrees.
        rng: seeded generator, so the run is reproducible.

    Returns:
        (alice_bit, bob_bit), each 0 or 1.
    """
    qc = circuit.copy()
    qc.ry(-math.radians(alice_angle), 0)
    qc.ry(-math.radians(bob_angle), 1)
    qc.measure_all()

    sim_seed = int(rng.integers(0, 2**31))
    counts = _SIMULATOR.run(qc, shots=1, seed_simulator=sim_seed).result().get_counts()

    bits = next(iter(counts))
    alice_bit = int(bits[1]) #less significant ---> Little Endian
    bob_bit = int(bits[0])
    return (alice_bit, bob_bit)



def sift(
    alice_angles: tuple[float, ...],
    bob_angles: tuple[float, ...],
    alice_outcomes: Bits,
    bob_outcomes: Bits,
) -> tuple[Bits, Bits]:
    """Keep the positions where both parties happened to pick the same angle.

    Only the two shared settings can match, so this is where the key comes from.
    On an ideal channel those outcomes are perfectly correlated and the two
    sifted keys are identical.

    Discarding is decided by the angles alone, never by comparing outcomes:
    comparing them would leak the key.

    Returns:
        Alice's and Bob's sifted keys, aligned index by index.

    Raises:
        ValueError: if the four inputs do not all have the same length.
    """
    if not (len(alice_angles) == len(bob_angles) == len(alice_outcomes) == len(bob_outcomes)):
            raise ValueError("All four sequences must have the same length")

    size = len(alice_angles)
    alice_sifted, bob_sifted = [], []
    for i in range(size):
        if alice_angles[i] == bob_angles[i]:
            angle = alice_angles[i]
            if angle in KEY_ANGLES:
                alice_sifted.append(alice_outcomes[i])
                bob_sifted.append(bob_outcomes[i])
    return (alice_sifted, bob_sifted)


def chsh_correlators(
    alice_angles: tuple[float, ...],
    bob_angles: tuple[float, ...],
    alice_outcomes: Bits,
    bob_outcomes: Bits,
) -> tuple[float, float, float, float]:
    """Group the run by setting pair and compute the four CHSH correlators.

    Returns them in the order CHSH_SETTINGS declares, which is the order
    metrics.chsh_S expects. Keeping the order in one place is deliberate: the
    two middle terms are easy to swap, and swapping them turns 2*sqrt(2) into 0
    without raising anything.

    Only the four CHSH combinations are used. The positions that produced the
    key are excluded — announcing them would reveal it — and the three
    combinations that are neither key nor Bell test are simply discarded.

    Each correlator needs enough pairs to be meaningful: see
    metrics.chsh_uncertainty for how many, and decide what should happen if a
    combination came up too rarely in a short run.

    Returns:
        (e_a1b1, e_a1b3, e_a3b1, e_a3b3).

    Raises:
        ValueError: if any of the four combinations produced no data at all.
    """
    if not (len(alice_angles) == len(alice_outcomes) == len(bob_angles) == len(bob_outcomes)):
        raise ValueError("All four sequences must have the same length")

    size = len(alice_angles)
    outcomes = []

    for (expected_alice_angle, expected_bob_angle) in CHSH_SETTINGS:

        correlator_alice_outcomes = []
        correlator_bob_outcomes = []

        for i in range(size):
            if alice_angles[i] == expected_alice_angle and bob_angles[i] == expected_bob_angle:
                correlator_alice_outcomes.append(alice_outcomes[i])
                correlator_bob_outcomes.append(bob_outcomes[i])

        if len(correlator_alice_outcomes) == 0 or len(correlator_bob_outcomes) == 0:
            raise ValueError("Cannot compute CHSH S without any data for correlator")

        outcomes.append(correlator(correlator_alice_outcomes, correlator_bob_outcomes))

    return tuple(outcomes)



def run(n_pairs: int, seed: int) -> E91Run:
    """Emit n_pairs, measure them at random angles, and sift.

    Both parties draw their angle independently and uniformly for every pair, so
    each of the nine combinations occurs about one ninth of the time. Only two
    of them build the key, which is why a given n_pairs yields far less key
    material here than in BB84.

    Use one generator for the whole run, seeded from `seed`, exactly as in
    bb84.run: three independent random sequences drawn from one stream. Deriving
    a fresh generator per call would correlate Alice's and Bob's choices, and a
    run in which the two always pick the same angle reports a flawless key and
    an S that means nothing.

    Args:
        n_pairs: how many entangled pairs the source emits.
        seed: seed for the run's random stream.

    Returns:
        The complete E91Run.
    """
    rng = np.random.default_rng(seed)

    # PHASE 1: Generating Bell Pair
    alice_angles = []
    bob_angles = []
    bell_p = bell_pair()

    # PHASE 2: Alice & Bob need to choose random angle for measuring
    alice_idx = rng.integers(0, len(ALICE_ANGLES), size=n_pairs)
    bob_idx   = rng.integers(0, len(BOB_ANGLES),   size=n_pairs)
    alice_angles = tuple(ALICE_ANGLES[i] for i in alice_idx)
    bob_angles   = tuple(BOB_ANGLES[i]   for i in bob_idx)
    alice_outcomes, bob_outcomes = [], []
    for i in range(n_pairs):
        alice_outcome, bob_outcome = measure_pair(circuit=bell_p, alice_angle=alice_angles[i], bob_angle=bob_angles[i], rng=rng)
        alice_outcomes.append(alice_outcome)
        bob_outcomes.append(bob_outcome)    

    # PHASE 3: sift the key
    alice_sifted, bob_sifted = sift(alice_angles=alice_angles, bob_angles=bob_angles, alice_outcomes=alice_outcomes, bob_outcomes=bob_outcomes)

    # PHASE 4: Both hold a sifted key. They are not necessarily equal yet — establishing that
    # is what the chsh S estimator is for.
    execution = E91Run(
        alice_angles = alice_angles,
        bob_angles = bob_angles,
        alice_outcomes = alice_outcomes,
        bob_outcomes = bob_outcomes,
        alice_sifted = alice_sifted,
        bob_sifted = bob_sifted
        )
    return execution