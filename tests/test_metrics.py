"""Tests for qkd.metrics.

Structural cases are filled in: they check contracts, not physics, and they
must pass for any correct implementation.

The statistical cases are deliberately left open. Choosing a sample size and a
tolerance is not a technical detail — it is the part you have to justify out
loud, so derive them rather than tuning until the bar turns green.
"""

import numpy as np
import pytest

from qkd.metrics import (
    agreement,
    chsh_S,
    chsh_uncertainty,
    correlator,
    qber,
    sifting_ratio,
)


class TestQber:
    def test_identical_keys_give_zero(self):
        key = [0, 1, 1, 0, 1, 0, 0, 1]
        assert qber(key, key) == 0.0

    def test_fully_opposite_keys_give_one(self):
        alice = [0, 1, 1, 0]
        bob = [1, 0, 0, 1]
        assert qber(alice, bob) == 1.0

    def test_counts_positionwise_not_setwise(self):
        # Same number of ones on both sides, but permuted: every position
        # disagrees. A count-based implementation would wrongly report 0.
        alice = [0, 0, 1, 1]
        bob = [1, 1, 0, 0]
        assert qber(alice, bob) == 1.0

    def test_length_mismatch_is_rejected(self):
        with pytest.raises(ValueError):
            qber([0, 1, 0], [0, 1])

    def test_empty_sample_is_rejected(self):
        # An undefined 0/0 must not silently become 0.0: an empty sample means
        # no estimate was made, which is not the same as "no errors".
        with pytest.raises(ValueError):
            qber([], [])


class TestAgreement:
    def test_complements_qber(self):
        alice = [0, 1, 1, 0, 1, 0]
        bob = [0, 1, 0, 0, 1, 1]
        assert agreement(alice, bob) == pytest.approx(1.0 - qber(alice, bob))


class TestSiftingRatio:
    def test_all_kept(self):
        assert sifting_ratio(100, 100) == 1.0

    def test_half_kept(self):
        assert sifting_ratio(50, 100) == 0.5

    def test_more_sifted_than_sent_is_rejected(self):
        with pytest.raises(ValueError):
            sifting_ratio(101, 100)


class TestCorrelator:
    """E is the mean of the *product* of the two outcomes, mapped to ±1."""

    def test_always_agreeing_gives_plus_one(self):
        key = [0, 1, 1, 0, 1]
        assert correlator(key, key) == 1.0

    def test_always_disagreeing_gives_minus_one(self):
        assert correlator([0, 1, 1, 0], [1, 0, 0, 1]) == -1.0

    def test_half_and_half_gives_zero(self):
        # Two agreements, two disagreements: the products cancel.
        assert correlator([0, 0, 0, 0], [0, 0, 1, 1]) == 0.0

    def test_agreement_on_ones_counts_as_agreement(self):
        # Guards against an implementation that averages the raw bits instead
        # of their ±1 product: that would rate (1,1) differently from (0,0).
        assert correlator([1, 1], [1, 1]) == correlator([0, 0], [0, 0])

    def test_length_mismatch_is_rejected(self):
        with pytest.raises(ValueError):
            correlator([0, 1], [0])

    def test_empty_is_rejected(self):
        with pytest.raises(ValueError):
            correlator([], [])


class TestChshS:
    """Only the convention-independent properties live here.

    Which term carries the minus sign is a modelling decision that has to be
    derived from the angle assignment, so the tests that pin an actual value
    belong below, once that decision is written down.
    """

    def test_all_zero_correlators_give_zero(self):
        assert chsh_S(0.0, 0.0, 0.0, 0.0) == 0.0

    def test_four_equal_correlators_give_twice_their_value(self):
        """Exactly one of the four terms is subtracted, so c+c+c-c = 2c.

        True whichever position the minus occupies, which is what makes this a
        usable test before the convention is fixed. It also catches the two
        obvious ways to get the sign structure wrong: no minus at all (4c) or
        two minuses (0).
        """
        assert chsh_S(0.5, 0.5, 0.5, 0.5) == pytest.approx(1.0)
        assert chsh_S(1.0, 1.0, 1.0, 1.0) == pytest.approx(2.0)


class TestChshUncertainty:
    """sigma_S = 2/sqrt(n): four independent correlators, each at most 1/sqrt(n)."""

    def test_matches_the_closed_form(self):
        assert chsh_uncertainty(4) == pytest.approx(1.0)
        assert chsh_uncertainty(100) == pytest.approx(0.2)
        assert chsh_uncertainty(10_000) == pytest.approx(0.02)

    def test_shrinks_as_the_square_root_of_the_sample(self):
        """Quadrupling the sample must halve the uncertainty, not quarter it."""
        assert chsh_uncertainty(400) == pytest.approx(chsh_uncertainty(100) / 2)

    def test_rejects_a_non_positive_sample(self):
        with pytest.raises(ValueError):
            chsh_uncertainty(0)
        with pytest.raises(ValueError):
            chsh_uncertainty(-10)

    def test_the_k3_sample_size_for_an_ideal_violation(self):
        """With k = 3, an ideal S = 2*sqrt(2) becomes declarable at n = 53.

        Pins the sizing rule n > (2k/(|S|-2))**2 against an off-by-one: at 52
        the bar still sits above the ideal value, at 53 it drops below. That
        boundary is the reason the docstring quotes 53 and not 52.
        """
        k = 3
        ideal_s = 2 * np.sqrt(2)
        assert 2 + k * chsh_uncertainty(52) > ideal_s
        assert 2 + k * chsh_uncertainty(53) < ideal_s


# TODO(B3): once the sign convention is derived and documented in `chsh_S`,
#   add the test that pins it: feed the four correlators that the optimal
#   angles produce — three at +1/sqrt(2) and the one under the minus at
#   -1/sqrt(2) — and assert S == 2*sqrt(2). That test is what stops the
#   convention from silently drifting later.
#
# TODO(D2): the end-to-end case belongs in test_e91.py — a simulated ideal run
#   must give S ~ 2.83, and the tolerance follows from sigma_S ~ 2/sqrt(N) per
#   setting, not from what makes the bar turn green.


# ---------------------------------------------------------------------------
# These functions are also exercised end to end against a real protocol run in
# test_bb84.py: QBER exactly zero on an ideal channel, and the sifting ratio
# holding near one half. Those tests belong there because they need a protocol.
#
# TODO(F5): once InterceptResend exists, assert that a fully intercepted BB84
#   run yields QBER ~ 0.25, and that a partially intercepted one is linear in
#   the intercepted fraction. Derive the tolerance from the binomial variance
#   on the sifted length, as in test_bb84.py.
# ---------------------------------------------------------------------------
