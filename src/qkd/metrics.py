"""Metrics computed on the outcome of a QKD run.

This module only *measures*. It knows nothing about protocols, channels or
attackers, and it never decides whether a run is acceptable: thresholds are
policy and live in the configuration, not here.

All functions take keys that have already been sifted. Sifting is the
protocol's responsibility (see bb84.py / e91.py), because the notion of
"matching bases" is protocol-specific.

DECLARED LIMITATION — the sacrificed sample is not modelled
============================================================
In the real protocol the QBER is estimated on a random SUBSET of the sifted key
which is announced publicly, compared, and then discarded: those bits are burnt
and cannot become key. This simulator compares the sifted keys in full, which a
simulation can do because it observes both sides at once and a participant
cannot.

The consequence is deliberate and worth stating rather than hiding. What is
being studied here is the VALUE of the error rate — how it grows with damping,
what an interception does to it, how it compares against a threshold — and none
of that needs the residual key length. Modelling the sacrifice would add a
parameter and make the QBER noisier, in exchange for a quantity the assignment
does not ask for.

It is also why there is no key-rate function. Without a sacrificed sample the
usable key IS the sifted key, so a key rate would be `sifting_ratio` under a
second name. The three-way distinction between sifted key, test sample and final
key is real and belongs in the report; it simply is not something this code
draws, and saying so is better than implying otherwise with a duplicate metric.
"""

from qkd.types import Bits


def _check_validity(sample: Bits) -> bool:
    """True if the sample is non-empty and holds nothing but 0 and 1."""
    if len(sample) == 0:
        return False
    return all(bit in (0, 1) for bit in sample)

# BB84 =========

def qber(alice_sample: Bits, bob_sample: Bits) -> float:
    """Quantum Bit Error Rate estimated on a revealed sample.

    The sample is a subset of the sifted key that Alice and Bob sacrifice by
    announcing it publicly, so that they can compare it bit by bit. Those bits
    are burned: they must not end up in the final key.

    Returns the fraction of positions where the two samples disagree, as a
    value in [0, 1] (not a percentage).

    Note on interpretation, worth stating in the report: a discrepancy here may
    come from channel noise or from an eavesdropper, and the two are not
    distinguishable from this number alone.

    Args:
        alice_sample: Alice's bits on the revealed positions.
        bob_sample: Bob's bits on the same positions, same order.

    Returns:
        Estimated QBER in [0, 1].

    Raises:
        ValueError: if the two samples have different lengths, or are empty.
    """
    is_valid_alice = _check_validity(alice_sample)
    is_valid_bob = _check_validity(bob_sample)

    if is_valid_alice and is_valid_bob:
        sample_size = -1
        if len(alice_sample) == len(bob_sample):
            sample_size = len(alice_sample)
        else:
            raise ValueError("Samples' size mismatch")

        errors = 0
        for i in range(sample_size):
            bit_a, bit_b = alice_sample[i], bob_sample[i]
            if bit_a != bit_b:
                errors += 1

        qber = errors / sample_size
        return qber
    else:
        raise ValueError("Invalid samples")


def agreement(alice_sample: Bits, bob_sample: Bits) -> float:
    """Fraction of positions where the two samples coincide.

    The complement of `qber` on the same input. Kept as a separate function
    because plots and event payloads read better in terms of agreement, and
    because a caller should not have to remember which convention is in use.

    Args:
        alice_sample: Alice's bits on the revealed positions.
        bob_sample: Bob's bits on the same positions, same order.

    Returns:
        Agreement in [0, 1].
    """
    is_valid_alice = _check_validity(alice_sample)
    is_valid_bob = _check_validity(bob_sample)

    if is_valid_alice and is_valid_bob:
        sample_size = -1
        if len(alice_sample) == len(bob_sample):
            sample_size = len(alice_sample)
        else:
            raise ValueError("Samples' size mismatch")

        coincidence = 0
        for i in range(sample_size):
            bit_a, bit_b = alice_sample[i], bob_sample[i]
            if bit_a == bit_b:
                coincidence += 1

        agreement = coincidence / sample_size
        return agreement # same as 1 - qber
    else:
        raise ValueError("Invalid samples")


def sifting_ratio(n_sifted: int, n_sent: int) -> float:
    """Fraction of transmitted qubits that survived sifting.

    Expected to sit around 0.5 for BB84 with uniformly random, independent
    basis choices — and to stay there regardless of channel quality, since
    sifting discards on basis mismatch, not on error.

    Args:
        n_sifted: length of the sifted key.
        n_sent: number of qubits Alice transmitted.

    Returns:
        Ratio in [0, 1].

    Raises:
        ValueError: if n_sent is not positive, or n_sifted exceeds it.
    """
    if n_sent < 0:
        raise ValueError(f"Cannot send {n_sent} bits")
    elif n_sifted > n_sent:
        raise ValueError(f"Cannot sift {n_sifted} bits if only {n_sent} sent")
    else:
        sifting_ratio =  n_sifted / n_sent
        return sifting_ratio


def correlator(alice_outcomes: Bits, bob_outcomes: Bits) -> float:
    """Correlation E between two sequences of paired measurement outcomes.

    Both sequences hold the outcomes recorded on the *same* setting pair, in the
    same order, one entry per measured pair of particles.

    E lives in [-1, 1]:
        +1  the two always agree
         0  no correlation at all
        -1  the two always disagree

    THE ±1 MAPPING IS NOT OPTIONAL. Outcomes arrive as bits 0/1, but a
    correlator is the mean of the *product* of the two results, and that product
    must be +1 when they agree and -1 when they disagree. Averaging 0/1 values
    directly produces a number that looks like a correlation and is not one —
    one of the standard ways to obtain a plausible but false S.

    Args:
        alice_outcomes: Alice's bits for this setting pair.
        bob_outcomes: Bob's bits for the same pairs, same order.

    Returns:
        The correlation in [-1, 1].

    Raises:
        ValueError: if the sequences differ in length or are empty.
    """
    if len(alice_outcomes) == len(bob_outcomes):
        results_number = len(alice_outcomes)
        if results_number > 0:
            products = []
            for a,b in zip(alice_outcomes, bob_outcomes):
                a_mapped = 0
                b_mapped = 0

                if a == 0: a_mapped = 1
                elif a == 1: a_mapped = -1
                else: raise ValueError("List's argument must be 0 or 1")

                if b == 0: b_mapped = 1
                elif b == 1: b_mapped = -1
                else: raise ValueError("List's argument must be 0 or 1")

                products.append(a_mapped * b_mapped) # Like a mapped xor: -1 neq / 1 eq

            E = sum(products) / len(products)
            return E

        else:
            raise ValueError("Cannot use empty results' lists")
    else:
        raise ValueError("Results' number mismatch")


def chsh_S(e_a1b1: float, e_a1b3: float, e_a3b1: float, e_a3b3: float) -> float:
    """CHSH parameter S from the four correlators, one per setting pair.

    Local hidden variable theories obey |S| <= 2. Quantum mechanics reaches
    2*sqrt(2) ~ 2.828 at the optimal angles, so a measured value above 2
    certifies that the pair is genuinely entangled — which is what makes S the
    security check of E91, stronger than BB84's error rate.

    SIGN CONVENTION, derived from the angle assignment and fixed here:

        Alice: a1 = 0 deg,  a3 = 90 deg
        Bob:   b1 = 45 deg, b3 = 135 deg

        S = E(a1,b1) - E(a1,b3) + E(a3,b1) + E(a3,b3)

    The minus sits on the second term because that is the only pair whose angles
    differ by 135 degrees: on the Bell state E = cos(theta_a - theta_b), so that
    correlator is -1/sqrt(2) while the other three are +1/sqrt(2). The minus
    turns it around, all four contribute with the same sign, and S reaches
    4/sqrt(2) = 2*sqrt(2).

    Put the minus on another term and S collapses towards zero with perfectly
    correct angles and perfectly correct correlators — no error, no exception,
    just a number stating there is no entanglement. Swapping e_a1b3 with e_a3b1
    at the call site does the same thing: it yields exactly 0.

    Note that the settings are ANGLES, not the Z/X bases of BB84. Only a1 and a3
    coincide with Z and X; Bob measures at 45 and 135 degrees, which are neither.
    Restricting all four settings to Z and X gives correlators 1, 0, 0, 1 and
    hence S = 2 exactly — the classical bound, never above it, whatever the
    state. That is why the previous implementation could not demonstrate a
    violation at all.

    Do NOT compute several sign combinations and return the largest. The
    previous implementation did that (Progetto_Tesi/Protocolli/e91.py, lines
    227-236) and the thesis itself records why it is invalid: taking a maximum
    over conventions can only overestimate S, so it manufactures a Bell
    violation out of noise. Fix the convention before running, not after.

    Sanity checks worth asserting before trusting any number this returns:
    E(0,0) = 1 and E(0,90) = 0 on the Bell state, and |S| <= 2*sqrt(2) always,
    since a value above Tsirelson's bound is a bug and never a discovery.

    The signature takes the four correlators already computed, rather than the
    raw outcomes keyed by setting pair. That keeps this module free of any
    protocol structure, consistent with the rest of it, at the cost of letting a
    caller swap two arguments unnoticed. The safeguard is a test that feeds the
    correlators of the optimal angles and demands 2*sqrt(2): it fails the moment
    the call site mixes them up.

    Args:
        e_a1b1: correlator for Alice's first setting with Bob's first.
        e_a1b3: correlator for Alice's first setting with Bob's second.
        e_a3b1: correlator for Alice's second setting with Bob's first.
        e_a3b3: correlator for Alice's second setting with Bob's second.

    Returns:
        S, in [-2*sqrt(2), 2*sqrt(2)].
    """
    S = e_a1b1 - e_a1b3 + e_a3b1 + e_a3b3
    return S


def chsh_uncertainty(n_per_setting: int) -> float:
    """Standard deviation of an S estimate built from n pairs per setting.

    S is estimated, not measured: with a finite sample it fluctuates around its
    true value, and comparing it to the classical bound of 2 is meaningless
    without knowing by how much.

    Each correlator is the mean of n products of +-1 outcomes. A +-1 variable
    with mean E has variance 1 - E^2, so the mean of n of them has standard
    deviation sqrt((1 - E^2)/n), at most 1/sqrt(n). The four correlators come
    from disjoint subsets of pairs, hence are independent, so their variances
    add — the signs in the CHSH combination do not matter, since Var(-X) =
    Var(X). Worst case that gives Var(S) <= 4/n, therefore:

        sigma_S <= 2 / sqrt(n)

    This function returns that bound. At the optimal angles every |E| = 1/sqrt2,
    so the true value is sqrt(2/n), about 30% smaller. Returning the bound is
    deliberate: it asks for more margin than strictly needed, and errs towards
    discarding a good key rather than accepting a compromised one.

    Intended use — the acceptance rule itself is policy and belongs in the
    configuration, not here:

        accept if abs(S) > 2 + k * chsh_uncertainty(n)   with k = 3

    k = 3 puts the chance of a classical state clearing the bar by fluctuation
    at about 0.13%. It follows that certifying a true S needs
    n > (2k / (abs(S) - 2))**2 pairs per setting: 53 at the ideal 2*sqrt(2),
    but 3600 once noise has pulled S down to 2.1 — which is why, in E5, the
    violation stops being declarable well before S actually reaches 2.

    Args:
        n_per_setting: pairs measured on each of the four setting combinations.

    Returns:
        The conservative standard deviation of the S estimate.

    Raises:
        ValueError: if n_per_setting is not positive.
    """
    if n_per_setting > 0:
        upper_bound = 2 / (n_per_setting**0.5)
        return upper_bound
    else:
        raise ValueError("Cannot work with negative N")