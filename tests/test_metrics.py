"""Tests for qkd.metrics.

Structural cases are filled in: they check contracts, not physics, and they
must pass for any correct implementation.

The statistical cases are deliberately left open. Choosing a sample size and a
tolerance is not a technical detail — it is the part you have to justify out
loud, so derive them rather than tuning until the bar turns green.
"""

import pytest

from qkd.metrics import agreement, qber, sifting_ratio


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

