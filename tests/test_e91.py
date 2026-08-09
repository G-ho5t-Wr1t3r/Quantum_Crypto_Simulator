"""Tests for qkd.e91 — ideal channel, no eavesdropper.

The order matters here. The invariants on single correlators come first,
because if E(0,0) and E(0,90) are wrong then every S computed downstream is
wrong too, and the CHSH tests would only tell you that something is broken
without saying where.
"""

import math

import numpy as np
import pytest

from qkd.e91 import (
    ALICE_ANGLES,
    BOB_ANGLES,
    CHSH_SETTINGS,
    KEY_ANGLES,
    E91Run,
    bell_pair,
    chsh_correlators,
    measure_pair,
    run,
    sift,
)
from qkd.metrics import chsh_S, chsh_uncertainty, correlator, qber

SEED = 20260809
TSIRELSON = 2 * math.sqrt(2)

# Sizing, derived rather than guessed. Each correlator is a mean of +-1
# products, so sigma_S <= 2/sqrt(n) with n pairs per setting combination; with
# k = 3 an ideal S = 2*sqrt(2) becomes declarable from n = 53. Each of the nine
# angle combinations occurs about one ninth of the time, so reaching n on all
# four CHSH combinations needs roughly 9n pairs. 1200 leaves comfortable margin
# on that ~480 without making the suite slow.
N_PAIRS = 1200
K = 3


# ---------------------------------------------------------------------------
# The angle sets
# ---------------------------------------------------------------------------


class TestAngles:
    def test_exactly_two_angles_are_shared(self):
        """The overlap is what makes a key possible at all."""
        assert set(ALICE_ANGLES) & set(BOB_ANGLES) == set(KEY_ANGLES)

    def test_chsh_settings_never_land_on_a_key_position(self):
        """The Bell test must not consume a position that carries key.

        Announcing a CHSH outcome means announcing that measurement, so the four
        combinations have to be disjoint from the key ones. A position becomes
        key when the two parties happen to pick the *same* angle — so what must
        hold is that the two angles differ, not that neither belongs to the
        shared set. Alice at 90 and Bob at 45 is a perfectly good CHSH pair even
        though both values appear in KEY_ANGLES: they simply do not match here.
        """
        for alice_angle, bob_angle in CHSH_SETTINGS:
            assert alice_angle != bob_angle

    def test_the_subtracted_term_is_the_one_135_degrees_apart(self):
        """Pins the sign convention to the geometry that justifies it.

        chsh_S subtracts its second argument. That is only correct if the second
        entry of CHSH_SETTINGS is the pair whose angles differ by 135 degrees,
        the one whose cosine is negative.
        """
        differences = [abs(a - b) for a, b in CHSH_SETTINGS]
        assert differences[1] == 135.0
        assert all(d == 45.0 for i, d in enumerate(differences) if i != 1)


# ---------------------------------------------------------------------------
# Correlator invariants — check these before trusting any S
# ---------------------------------------------------------------------------


class TestCorrelatorInvariants:
    """The two checks that catch a wrong rotation sense or a wrong angle unit."""

    @staticmethod
    def _measure_many(alice_angle, bob_angle, n, seed=SEED):
        rng = np.random.default_rng(seed)
        alice_bits, bob_bits = [], []
        for _ in range(n):
            a, b = measure_pair(bell_pair(), alice_angle, bob_angle, rng)
            alice_bits.append(a)
            bob_bits.append(b)
        return correlator(alice_bits, bob_bits)

    def test_same_angle_gives_perfect_correlation(self):
        """E(0, 0) = +1 on |Phi+>: identical settings, identical outcomes.

        Exact, with no tolerance: on a noiseless channel with the same angle the
        two outcomes always agree, so every product is +1 and no fluctuation is
        possible. A value below 1 here is a bug, not statistics.
        """
        assert self._measure_many(0.0, 0.0, 200) == 1.0

    def test_orthogonal_angles_give_no_correlation(self):
        """E(0, 90) = 0: statistical, so the tolerance comes from the variance.

        A +-1 mean over n samples has sigma <= 1/sqrt(n); at 4 sigma with
        n = 400 that is 0.2.
        """
        n = 400
        assert self._measure_many(0.0, 90.0, n) == pytest.approx(
            0.0, abs=4 / math.sqrt(n)
        )

    def test_forty_five_degrees_gives_one_over_root_two(self):
        """E(0, 45) = cos(45) = 1/sqrt(2).

        The invariant that a factor-two error in the rotation parameter cannot
        survive: doubling or halving the angle moves this to 1 or to 0.
        """
        n = 400
        assert self._measure_many(0.0, 45.0, n) == pytest.approx(
            1 / math.sqrt(2), abs=4 / math.sqrt(n)
        )


# ---------------------------------------------------------------------------
# Sifting and the shape of a run
# ---------------------------------------------------------------------------


class TestRun:
    def test_returns_an_e91run_of_the_requested_length(self):
        result = run(n_pairs=90, seed=SEED)
        assert isinstance(result, E91Run)
        assert len(result.alice_angles) == 90
        assert len(result.bob_angles) == 90
        assert len(result.alice_outcomes) == 90
        assert len(result.bob_outcomes) == 90

    def test_parties_only_use_their_own_angle_set(self):
        result = run(n_pairs=90, seed=SEED)
        assert set(result.alice_angles) <= set(ALICE_ANGLES)
        assert set(result.bob_angles) <= set(BOB_ANGLES)

    def test_sifted_keys_are_identical_on_an_ideal_channel(self):
        """The E91 counterpart of C2: matching angles, perfect correlation.

        Exact assertion, same reasoning as BB84's ideal-channel test.
        """
        result = run(n_pairs=N_PAIRS, seed=SEED)
        assert len(result.alice_sifted) > 0
        assert result.alice_sifted == result.bob_sifted
        assert qber(result.alice_sifted, result.bob_sifted) == 0.0

    def test_sifting_keeps_about_two_ninths_of_the_pairs(self):
        """Two of the nine angle combinations carry key.

        Binomial mean with p = 2/9, so sigma = sqrt(p(1-p)/n); four sigma at
        n = N_PAIRS. Markedly less than BB84's half, and worth stating in the
        report: E91 buys its cheaper security check with a lower key yield.
        """
        result = run(n_pairs=N_PAIRS, seed=SEED)
        p = 2 / 9
        tol = 4 * math.sqrt(p * (1 - p) / N_PAIRS)
        assert len(result.alice_sifted) / N_PAIRS == pytest.approx(p, abs=tol)

    def test_same_seed_reproduces_the_run(self):
        assert run(n_pairs=90, seed=SEED) == run(n_pairs=90, seed=SEED)

    def test_different_seeds_diverge(self):
        assert run(n_pairs=90, seed=SEED) != run(n_pairs=90, seed=SEED + 1)

    def test_angle_choices_are_drawn_independently(self):
        """Guards against a per-call generator correlating the two choices.

        If Alice and Bob always picked the same angle, every position would
        survive sifting and S would be computed on nothing.
        """
        result = run(n_pairs=N_PAIRS, seed=SEED)
        assert result.alice_angles != result.bob_angles


# ---------------------------------------------------------------------------
# D2: the Bell violation
# ---------------------------------------------------------------------------


class TestChshViolation:
    def test_ideal_run_reaches_tsirelson(self):
        """S ~ 2.83 on an ideal channel with the optimal angles.

        Tolerance from sigma_S <= 2/sqrt(n) at four sigma, with n the smallest
        of the four CHSH groups — the weakest one drives the uncertainty.
        """
        result = run(n_pairs=N_PAIRS, seed=SEED)
        correlators = chsh_correlators(
            result.alice_angles,
            result.bob_angles,
            result.alice_outcomes,
            result.bob_outcomes,
        )
        s = chsh_S(*correlators)
        n_smallest = min(
            sum(
                1
                for alice_angle, bob_angle in zip(result.alice_angles, result.bob_angles)
                if (alice_angle, bob_angle) == setting
            )
            for setting in CHSH_SETTINGS
        )
        assert s == pytest.approx(TSIRELSON, abs=4 * chsh_uncertainty(n_smallest))

    def test_ideal_run_clears_the_acceptance_criterion(self):
        """Accept only if |S| > 2 + k*sigma, with k = 3.

        This is the rule that will move into the configuration at G1 and be
        applied by the engine at H2. Written out here so that the behaviour is
        pinned before it migrates, and so the migration can be checked against
        something.

        A false negative costs time, a false positive costs the key: hence a
        margin of three sigma rather than a bare comparison against 2.
        """
        result = run(n_pairs=N_PAIRS, seed=SEED)
        s = chsh_S(
            *chsh_correlators(
                result.alice_angles,
                result.bob_angles,
                result.alice_outcomes,
                result.bob_outcomes,
            )
        )
        n_per_setting = N_PAIRS // 9
        assert abs(s) > 2 + K * chsh_uncertainty(n_per_setting)

    def test_every_correlator_stays_within_the_unit_range(self):
        """Each E is a mean of +-1 products, so |E| <= 1 exactly, always.

        No statistics involved: this holds for every sample of every size. A
        correlator outside the range means it was built on raw 0/1 bits rather
        than on their +-1 products, which is the standard way to end up with a
        plausible but false S.
        """
        result = run(n_pairs=400, seed=SEED)
        correlators = chsh_correlators(
            result.alice_angles,
            result.bob_angles,
            result.alice_outcomes,
            result.bob_outcomes,
        )
        assert len(correlators) == 4
        for e in correlators:
            assert -1.0 <= e <= 1.0

    def test_s_averaged_over_runs_settles_below_tsirelson(self):
        """The Tsirelson bound constrains the true S, not a finite-sample estimate.

        A single run can and does exceed 2*sqrt(2) by chance — with n pairs per
        setting the estimate carries sigma <= 2/sqrt(n), so an excess of one or
        two sigma is ordinary. Asserting that no individual run ever exceeds the
        bound would be asserting that a sample mean never exceeds the true mean.

        What must hold is that S does not exceed it *systematically*. Averaging
        over runs divides the uncertainty by sqrt(runs), so the mean is pinned
        much more tightly than any single estimate. A leftover
        maximum-over-sign-conventions would show up here, because taking a
        maximum biases every run upwards rather than scattering them.
        """
        runs = 8
        values = []
        for offset in range(runs):
            result = run(n_pairs=N_PAIRS, seed=SEED + offset)
            values.append(
                chsh_S(
                    *chsh_correlators(
                        result.alice_angles,
                        result.bob_angles,
                        result.alice_outcomes,
                        result.bob_outcomes,
                    )
                )
            )
        mean_s = sum(values) / runs
        sigma_of_mean = chsh_uncertainty(N_PAIRS // 9) / math.sqrt(runs)
        assert abs(mean_s) <= TSIRELSON + 3 * sigma_of_mean


# ---------------------------------------------------------------------------
# Sift contract
# ---------------------------------------------------------------------------


class TestSift:
    def test_keeps_only_matching_angles(self):
        a_angles = (45.0, 0.0, 90.0, 45.0)
        b_angles = (45.0, 45.0, 90.0, 135.0)  # positions 0 and 2 match
        a, b = sift(a_angles, b_angles, [1, 0, 1, 0], [1, 1, 1, 1])
        assert a == [1, 1]
        assert b == [1, 1]

    def test_length_mismatch_is_rejected(self):
        with pytest.raises(ValueError):
            sift((45.0, 90.0), (45.0,), [0, 1], [0, 1])
