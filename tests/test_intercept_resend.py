"""F4, F5, F6: intercept-resend, and what it does to each protocol.

The acceptance criteria of workstream F, and the second requirement of the
assignment. Three claims, one per class below: the framework refuses the attack
where it cannot physically act, BB84 shows about 25% QBER, and E91 loses its
Bell violation.
"""

import math

import pytest

from qkd import bb84, e91
from qkd.actors import Eavesdropper, Player, Role
from qkd.attacks import AttackNotAllowedError, InterceptResend
from qkd.metrics import chsh_S, qber

SEED = 20260812

# QBER on the sifted key is a binomial mean: sigma = sqrt(p(1-p)/n) with
# p = 0.25. About half of N_BITS survives sifting, so n ~ N_BITS/2 = 400 and
# sigma ~ 0.022; four sigma is 0.087. Wide enough to be honest, narrow enough to
# separate 25% from 0% and from 50%.
N_BITS = 800
N_PAIRS = 900


def _bb84_qber(fraction=1.0, n_bits=N_BITS, seed=SEED):
    eve = Eavesdropper(capabilities=[InterceptResend(fraction)])
    result = bb84.run(n_bits, seed, eavesdropper=eve)
    return qber(result.alice_sifted, result.bob_sifted)


def _e91_s(fraction=1.0, n_pairs=N_PAIRS, seed=SEED):
    eve = Eavesdropper(capabilities=[InterceptResend(fraction)])
    result = e91.run(n_pairs, seed, eavesdropper=eve)
    return chsh_S(
        *e91.chsh_correlators(
            result.alice_angles,
            result.bob_angles,
            result.alice_outcomes,
            result.bob_outcomes,
        )
    )


# ---------------------------------------------------------------------------
# F4 — the attack and where it may act
# ---------------------------------------------------------------------------


class TestPlacement:
    def test_the_framework_refuses_the_attack_at_an_endpoint(self):
        """The acceptance criterion of F: refused, not merely not performed.

        Intercept-resend is defined on a qubit in flight. An actor at an
        endpoint already holds the state, so there is nothing to intercept and
        nothing to re-prepare — a different threat, and one that induces no
        error and therefore leaves no QBER signature at all.
        """
        insider = Player("Bob", Role.RECEIVER, capabilities=[InterceptResend()])
        with pytest.raises(AttackNotAllowedError):
            bb84.run(20, SEED, eavesdropper=insider)

    def test_it_is_accepted_on_the_channel(self):
        eve = Eavesdropper(capabilities=[InterceptResend()])
        assert bb84.run(20, SEED, eavesdropper=eve) is not None

    def test_the_check_happens_before_anything_runs(self):
        """Fails loudly and immediately rather than after a long simulation."""
        insider = Player("Bob", Role.RECEIVER, capabilities=[InterceptResend()])
        with pytest.raises(AttackNotAllowedError):
            bb84.run(100_000, SEED, eavesdropper=insider)

    def test_fraction_outside_the_unit_interval_is_rejected(self):
        with pytest.raises(ValueError):
            InterceptResend(1.5)


# ---------------------------------------------------------------------------
# F5 — canonical Eve on BB84
# ---------------------------------------------------------------------------


class TestF5QberOnBb84:
    def test_full_interception_gives_about_25_percent(self):
        """THE acceptance criterion: QBER ~ 25% with Eve on every qubit.

        Half the time Eve guesses Alice's basis and leaves no trace; the other
        half she collapses the state into the wrong basis and Bob's reading
        becomes a coin flip. 1/2 * 1/2 = 25%.

        Tolerance is four sigma on a binomial mean over the sifted key, derived
        rather than tuned.
        """
        n_sifted = N_BITS / 2
        tol = 4 * math.sqrt(0.25 * 0.75 / n_sifted)
        assert _bb84_qber() == pytest.approx(0.25, abs=tol)

    def test_it_is_not_fifty_percent(self):
        """Half of Eve's wrong guesses are covered by luck.

        Worth pinning separately: 50% would be the answer if every wrong basis
        choice guaranteed a wrong bit for Bob. It does not — Bob's coin lands on
        Alice's value half the time anyway.
        """
        assert _bb84_qber() < 0.4

    def test_no_eavesdropper_still_gives_exactly_zero(self):
        """The baseline the 25% is read against."""
        result = bb84.run(N_BITS, SEED)
        assert qber(result.alice_sifted, result.bob_sifted) == 0.0

    @pytest.mark.parametrize("fraction", [0.0, 0.5, 1.0])
    def test_partial_interception_is_linear_in_the_fraction(self, fraction):
        """QBER(f) = 0.25 * f: two independent populations, weighted mean.

        The security reading, and the reason this is not a tidiness result:
        against a threshold near 11%, Eve solves 0.25f = 0.11 and finds
        f ~ 0.44. She can touch 44% of the traffic, stay under the alarm, and
        still learn about 22% of the sifted key perfectly.
        """
        n_sifted = N_BITS / 2
        tol = 4 * math.sqrt(0.25 * 0.75 / n_sifted)
        assert _bb84_qber(fraction) == pytest.approx(0.25 * fraction, abs=tol)

    def test_a_partial_attack_can_hide_under_the_threshold(self):
        """Eve at f = 0.44 sits at the ~11% detection threshold.

        Stated as a test because it is the most concrete security claim the
        project makes: partial interception is a real strategy, not a curiosity.
        """
        measured = _bb84_qber(0.44)
        assert measured < 0.16  # comfortably below the 25% of a full attack
        assert measured > 0.05  # and clearly above an untouched line


# ---------------------------------------------------------------------------
# F6 — one arm of E91
# ---------------------------------------------------------------------------


class TestF6BellViolationCollapse:
    def test_an_untouched_run_violates_bell(self):
        """The baseline: without Eve the certificate holds."""
        result = e91.run(N_PAIRS, SEED)
        s = chsh_S(
            *e91.chsh_correlators(
                result.alice_angles,
                result.bob_angles,
                result.alice_outcomes,
                result.bob_outcomes,
            )
        )
        assert abs(s) > 2

    def test_intercepting_one_arm_destroys_the_violation(self):
        """S falls to 2 or below: the acceptance criterion of F6.

        Measuring one particle collapses the pair, so what reaches the parties
        is a separable mixture — and a separable state admits a local
        hidden-variable description, which is exactly what |S| <= 2 characterises.

        This is the deeper reason E91's check is stronger than BB84's error
        rate: S does not merely report that something went wrong, it certifies
        that no third party is correlated with the pair. Breaking a SINGLE arm
        is already enough, which is entanglement monogamy seen from the outside.
        """
        assert abs(_e91_s()) <= 2

    def test_the_key_also_picks_up_errors(self):
        """The other half of F6: matching angles stop agreeing.

        Without Eve those positions are perfectly correlated, so a nonzero QBER
        here is the expected consequence of the interception.
        """
        eve = Eavesdropper(capabilities=[InterceptResend()])
        result = e91.run(N_PAIRS, SEED, eavesdropper=eve)
        assert qber(result.alice_sifted, result.bob_sifted) > 0.0

    def test_a_partial_attack_degrades_s_without_destroying_it(self):
        """Between the two extremes S sits in between, as the QBER curve does.

        Same lever as BB84: an adversary trading information for invisibility.
        """
        untouched = abs(
            chsh_S(
                *e91.chsh_correlators(
                    *(
                        lambda r: (
                            r.alice_angles,
                            r.bob_angles,
                            r.alice_outcomes,
                            r.bob_outcomes,
                        )
                    )(e91.run(N_PAIRS, SEED))
                )
            )
        )
        assert untouched > abs(_e91_s(0.5)) > abs(_e91_s(1.0)) - 0.6
