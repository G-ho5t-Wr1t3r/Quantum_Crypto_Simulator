"""E4 and E5: the protocols run over a real quantum channel.

These are the acceptance tests of the assignment's third requirement. They do
not check plumbing — they check that the physics comes out, and each one
corresponds to a claim the report will make.

Sample sizes are small on purpose. Every qubit is a separate Aer call in
density-matrix mode, so cost is linear in the number of qubits and a sweep over
several gamma values multiplies it. Tolerances are derived from the binomial
variance, which is why modest samples are still enough to separate the curves.
"""

import math

import pytest

from qkd import bb84, e91
from qkd.channels import AmplitudeDamping, IdealChannel
from qkd.metrics import chsh_S, qber

SEED = 20260810

# QBER is a binomial mean over the sifted key, so sigma = sqrt(p(1-p)/n) <=
# 0.5/sqrt(n). With ~half of N_BITS surviving sifting and then splitting in two
# by basis, each subset holds about N_BITS/4.
N_BITS = 600
N_PAIRS = 600


def _qber_by_basis(gamma, n_bits=N_BITS, seed=SEED):
    """Run BB84 through the damping and split the QBER by measurement basis."""
    result = bb84.run(n_bits, seed, channel=AmplitudeDamping(gamma))
    out = {}
    for basis in (0, 1):
        alice, bob = result.sifted_in_basis(basis)
        out[basis] = qber(alice, bob)
    return out


def _s_value(gamma, n_pairs=N_PAIRS, seed=SEED):
    result = e91.run(n_pairs, seed, channel=AmplitudeDamping(gamma))
    return chsh_S(
        *e91.chsh_correlators(
            result.alice_angles,
            result.bob_angles,
            result.alice_outcomes,
            result.bob_outcomes,
        )
    )


# ---------------------------------------------------------------------------
# E4 — QBER against gamma on BB84
# ---------------------------------------------------------------------------


class TestE4QberVersusGamma:
    def test_an_ideal_channel_still_gives_exactly_zero(self):
        """The baseline the noisy curves are read against.

        Also a regression guard on the integration itself: if the channel were
        applied in the wrong place, or accumulated across qubits, this would be
        the first thing to break.
        """
        result = bb84.run(N_BITS, SEED, channel=IdealChannel())
        assert qber(result.alice_sifted, result.bob_sifted) == 0.0

    def test_the_curve_grows_with_gamma(self):
        """Monotone and physically sensible, as the acceptance criterion asks.

        Compared on the pooled sifted key, so this is the curve the report
        plots. Endpoints are far enough apart that sampling noise cannot invert
        them.
        """
        values = []
        for gamma in (0.0, 0.2, 0.5, 0.9):
            result = bb84.run(N_BITS, SEED, channel=AmplitudeDamping(gamma))
            values.append(qber(result.alice_sifted, result.bob_sifted))

        assert values == sorted(values)
        assert values[0] == 0.0
        assert values[-1] > 0.2

    @pytest.mark.parametrize("gamma", [0.3, 0.6])
    def test_each_basis_matches_its_closed_form(self, gamma):
        """QBER_Z = gamma/2 and QBER_X = (1 - sqrt(1-gamma))/2.

        The tolerance is four sigma on a binomial mean over roughly N_BITS/4
        samples, not a number tuned until the test passed.
        """
        measured = _qber_by_basis(gamma)
        n_per_basis = N_BITS / 4
        tol = 4 * 0.5 / math.sqrt(n_per_basis)

        assert measured[0] == pytest.approx(gamma / 2, abs=tol)
        assert measured[1] == pytest.approx((1 - math.sqrt(1 - gamma)) / 2, abs=tol)

    def test_the_z_basis_is_noisier_than_the_x_basis(self):
        """THE RESULT OF E4, and the fingerprint of amplitude damping.

        A symmetric channel — depolarizing, or a classical bit flip — would give
        the same error in both bases. The gap is what proves the channel models
        directional energy loss rather than generic noise, and it is the plot
        the report leads with.
        """
        measured = _qber_by_basis(0.6)
        assert measured[0] > measured[1]


# ---------------------------------------------------------------------------
# E5 — amplitude damping on E91
# ---------------------------------------------------------------------------


class TestE5DampingOnE91:
    def test_an_ideal_channel_still_violates_bell(self):
        """The baseline: without noise the violation is intact."""
        assert _s_value(0.0) > 2

    def test_s_degrades_as_gamma_grows(self):
        """Damping erodes the correlations, so S falls away from 2*sqrt(2).

        Only the initial regime is asserted, because the curve is NOT monotone
        over the whole range — see test_the_curve_saturates_rather_than_vanishing.

        The two points are chosen far apart on purpose: with N_PAIRS the weakest
        setting combination holds about N_PAIRS/9 pairs, so sigma_S ~ 2/sqrt(66)
        ~ 0.25. The exact values here are 2.83 and 1.41, a gap of roughly six
        sigma, which sampling noise cannot invert. Comparing neighbouring gamma
        values instead would be comparing noise.
        """
        assert _s_value(0.0) > _s_value(0.5)

    def test_heavy_damping_destroys_the_violation(self):
        """S drops to 2 or below: the certificate is gone.

        The security reading, and the point worth making in the report: NOISE
        ALONE can destroy the Bell violation, with no eavesdropper anywhere. A
        protocol that aborts on |S| <= 2 therefore discards perfectly honest
        keys once the fibre is long enough — which is why E91 cannot separate
        loss from attack, and why the worst case attributes everything to Eve.

        Exactly, the violation is lost at gamma ~ 0.22, which by
        gamma = 1 - exp(-L/L0) is about 5.4 km of standard fibre.
        """
        assert abs(_s_value(0.5)) <= 2

    def test_the_curve_saturates_rather_than_vanishing(self):
        """S does not fall to zero: it bottoms out and climbs back to sqrt(2).

        At gamma = 1 both arms are forced into |0>, so the pair ends up in the
        product state |00>. A separable state does not have null correlators —
        it has FACTORISABLE ones, E(a,b) = cos(a)*cos(b), and with the CHSH
        angles that sums to exactly sqrt(2).

        So the curve descends from 2*sqrt(2), reaches a minimum of about 1.24
        near gamma = 0.75, and rises again to 1.414. Worth stating in the
        report, because a reader expecting a monotone decay to zero will assume
        the plot is wrong. What the plot actually shows is a state losing its
        entanglement and settling into a classically correlated one — and no
        amount of classical correlation can exceed 2.
        """
        assert _s_value(1.0) == pytest.approx(math.sqrt(2), abs=0.5)
        assert abs(_s_value(1.0)) <= 2

    def test_sifted_keys_disagree_once_the_channel_is_noisy(self):
        """The other half of E5: damping raises the QBER on E91 too.

        The key comes from matching angles, where an ideal channel gives perfect
        correlation. Damping breaks it, so a nonzero QBER here is the expected
        consequence rather than a bug.
        """
        result = e91.run(N_PAIRS, SEED, channel=AmplitudeDamping(0.6))
        assert qber(result.alice_sifted, result.bob_sifted) > 0.0
