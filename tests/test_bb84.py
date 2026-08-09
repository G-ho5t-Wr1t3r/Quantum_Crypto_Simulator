"""Tests for qkd.bb84 — ideal channel, no eavesdropper.

Two kinds of test live here and they must not be confused.

Exact tests assert equality with no tolerance. They are legitimate because on a
noiseless channel, with Alice and Bob in the same basis, the measurement is
deterministic: there is no statistical fluctuation to absorb. A nonzero result
there is a bug, never noise.

Statistical tests assert a value within a tolerance derived from the variance of
a binomial mean, sigma = sqrt(p(1-p)/N). The tolerance is computed from N, not
chosen until the bar turns green — that distinction is the whole point.
"""

import numpy as np
import pytest

from qkd.bb84 import BB84Run, measure, prepare, random_bits, run, sift
from qkd.metrics import qber, sifting_ratio

SEED = 20260806


# ---------------------------------------------------------------------------
# Exact: the encoding convention
# ---------------------------------------------------------------------------


class TestConvention:
    """Pin the encoding convention documented in `prepare`.

    This is the test that matters most in the file. If `prepare` and `measure`
    ever drift apart, it fails here and immediately — instead of surfacing three
    tasks later as a QBER that is mysteriously not zero.
    """

    @pytest.mark.parametrize("bit", [0, 1])
    @pytest.mark.parametrize("basis", [0, 1])
    def test_same_basis_round_trip(self, bit, basis):
        rng = np.random.default_rng(SEED)
        circuit = prepare(bit, basis)
        assert measure(circuit, basis, rng) == bit

    def test_prepare_rejects_invalid_bit(self):
        with pytest.raises(ValueError):
            prepare(2, 0)

    def test_prepare_rejects_invalid_basis(self):
        with pytest.raises(ValueError):
            prepare(0, 2)

    def test_measure_rejects_invalid_basis(self):
        rng = np.random.default_rng(SEED)
        with pytest.raises(ValueError):
            measure(prepare(0, 0), 2, rng)


# ---------------------------------------------------------------------------
# Exact: sifting
# ---------------------------------------------------------------------------


class TestSift:
    def test_keeps_only_matching_bases(self):
        alice_bits = [0, 1, 1, 0]
        alice_bases = [0, 0, 1, 1]
        bob_bits = [0, 1, 0, 0]
        bob_bases = [0, 1, 1, 0]  # positions 0 and 2 match
        a, b = sift(alice_bits, alice_bases, bob_bits, bob_bases)
        assert a == [0, 1]
        assert b == [0, 0]

    def test_discards_on_basis_mismatch_even_when_bits_agree(self):
        # Position 0 has identical bits but different bases: it must still go.
        # Sifting is decided by the basis alone; comparing values here would
        # leak the key and destroy the meaning of the QBER computed afterwards.
        a, b = sift([1], [0], [1], [1])
        assert a == []
        assert b == []

    def test_length_mismatch_is_rejected(self):
        with pytest.raises(ValueError):
            sift([0, 1], [0, 1], [0], [0, 1])


# ---------------------------------------------------------------------------
# Exact: the C2 acceptance criterion
# ---------------------------------------------------------------------------


class TestIdealChannel:
    def test_qber_is_exactly_zero(self):
        """C2: ideal channel, no Eve -> the sifted keys are identical.

        Asserted with `== 0.0` and no tolerance, deliberately. On matching bases
        over a noiseless channel the outcome is deterministic, so any nonzero
        value is a defect in the code and not a fluctuation to be tolerated.
        """
        result = run(n_bits=200, seed=SEED)
        assert qber(result.alice_sifted, result.bob_sifted) == 0.0

    def test_sifted_keys_are_aligned_and_non_empty(self):
        result = run(n_bits=200, seed=SEED)
        assert len(result.alice_sifted) == len(result.bob_sifted)
        assert len(result.alice_sifted) > 0

    def test_raw_sequences_all_have_the_requested_length(self):
        n = 64
        result = run(n_bits=n, seed=SEED)
        assert len(result.alice_bits) == n
        assert len(result.alice_bases) == n
        assert len(result.bob_bases) == n
        assert len(result.bob_bits) == n

    def test_run_returns_a_bb84run(self):
        assert isinstance(run(n_bits=8, seed=SEED), BB84Run)


# ---------------------------------------------------------------------------
# Exact: reproducibility
# ---------------------------------------------------------------------------


class TestReproducibility:
    def test_same_seed_gives_an_identical_run(self):
        """Every figure in the report has to be reproducible; this is what pins it."""
        first = run(n_bits=64, seed=SEED)
        second = run(n_bits=64, seed=SEED)
        assert first == second

    def test_different_seeds_give_different_runs(self):
        """Guards against a seed that is accepted and then silently ignored.

        With 64 bits the chance of two independent runs coinciding is about
        2**-64, so a failure here means the seed is not reaching the generators.
        """
        assert run(n_bits=64, seed=SEED) != run(n_bits=64, seed=SEED + 1)

    def test_alice_bits_and_bases_are_drawn_independently(self):
        """Bits and bases must come from successive draws of the same stream.

        If a fresh generator were built from the seed at each call, these two
        sequences would be identical — and so would Bob's bases, making every
        position survive sifting and every QBER come out zero.
        """
        result = run(n_bits=128, seed=SEED)
        assert result.alice_bits != result.alice_bases
        assert result.alice_bases != result.bob_bases


# ---------------------------------------------------------------------------
# Statistical: tolerances derived from the binomial variance
# ---------------------------------------------------------------------------

# Both quantities below are means of Bernoulli(p=0.5) variables, so
#     sigma = sqrt(p(1-p)/N) = 0.5 / sqrt(N)
# With N = 400 that is 0.025, and a 4-sigma band is 0.10. Four sigma keeps the
# false-failure rate around 6e-5 per assertion, which is what you want from a
# test that runs on every commit. N is kept modest on purpose: every bit costs
# one separate Aer call, so the cost is linear in N and already noticeable here.

N_STAT = 400
SIGMA = 0.5 / np.sqrt(N_STAT)
TOL = 4 * SIGMA


class TestStatistics:
    def test_about_half_the_positions_survive_sifting(self):
        """Bases agree half the time, so roughly half the qubits survive."""
        result = run(n_bits=N_STAT, seed=SEED)
        ratio = sifting_ratio(len(result.alice_sifted), N_STAT)
        assert ratio == pytest.approx(0.5, abs=TOL)

    def test_sifting_ratio_does_not_depend_on_the_seed(self):
        """The ratio is combinatorial, not physical.

        It comes from Alice and Bob choosing bases independently and uniformly,
        so it stays near 0.5 whatever the run — and, later on, whatever the
        channel does. A channel that changed this number would mean the
        discarding rule had been wired to something other than the bases.
        """
        for offset in range(3):
            result = run(n_bits=N_STAT, seed=SEED + offset)
            ratio = sifting_ratio(len(result.alice_sifted), N_STAT)
            assert ratio == pytest.approx(0.5, abs=TOL)

    def test_measuring_in_the_wrong_basis_is_a_coin_flip(self):
        """Prepare in one basis, read in the other: the outcome carries no signal.

        This is the counterpart of the round-trip test, and the reason those
        positions are discarded rather than merely distrusted.
        """
        rng = np.random.default_rng(SEED)
        ones = sum(measure(prepare(0, 0), 1, rng) for _ in range(N_STAT))
        assert ones / N_STAT == pytest.approx(0.5, abs=TOL)


# ---------------------------------------------------------------------------
# Exact: helpers
# ---------------------------------------------------------------------------


class TestRandomBits:
    def test_length_and_domain(self):
        rng = np.random.default_rng(SEED)
        bits = random_bits(50, rng)
        assert len(bits) == 50
        assert set(bits) <= {0, 1}

    def test_returns_plain_ints_not_numpy_scalars(self):
        """Downstream code and the type aliases expect a Sequence[int].

        A numpy array is not formally a Sequence, and numpy scalars compare
        equal to ints but serialise differently — which would surface much later,
        when a run is exported to JSON over the API.
        """
        rng = np.random.default_rng(SEED)
        bits = random_bits(10, rng)
        assert isinstance(bits, list)
        assert all(type(b) is int for b in bits)
