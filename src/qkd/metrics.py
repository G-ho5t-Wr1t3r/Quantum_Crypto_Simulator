"""Metrics computed on the outcome of a QKD run.

This module only *measures*. It knows nothing about protocols, channels or
attackers, and it never decides whether a run is acceptable: thresholds are
policy and live in the configuration, not here.

All functions take keys that have already been sifted. Sifting is the
protocol's responsibility (see bb84.py / e91.py), because the notion of
"matching bases" is protocol-specific.
"""

from qkd.types import Bits


def _check_validity(sample: Bits) -> bool:
    """Checks if the sample is valid (contains only 0 or 1)"""
    if len(sample) == 0:
        return False
    return all(bit in (0, 1) for bit in sample)


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
        return agreement # same of 1 - qber
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


def key_rate(n_final: int, n_sent: int) -> float:
    """Usable key bits obtained per qubit transmitted.

    n_final must be the the sifted key - public bits
    
    Whatever you pick, the docstring must say it, and the report must use the
    same words. Do not let the same symbol mean two things in two chapters.

    Args:
        n_final: length of the key you are claiming as the output.
        n_sent: number of qubits Alice transmitted.

    Returns:
        Rate in [0, 1].

    Raises:
        ValueError: 
            - if n_sent < 0
            - if n_final < 0
            - if n_final > n_sent
    """
    if n_sent < 0:
        raise ValueError("Cannot send a negative quantity of bits")
    elif n_final < 0:
        raise ValueError("The final value (sifted key - revealed bits) cannot be negative")
    elif n_final > n_sent:
        raise ValueError("Final value cannot be bigger than sent bits")
    else:
        return n_final / n_sent