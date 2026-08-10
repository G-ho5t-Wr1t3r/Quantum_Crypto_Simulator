"""Tests for qkd.channels.

E1 only covers the abstraction and the ideal case. The tests that matter
physically arrive with E2: that the Kraus operators are complete, that the
damping is asymmetric, and that QBER_Z comes out at roughly twice QBER_X.
"""

import math

import numpy as np
import pytest
from qiskit import QuantumCircuit
from qiskit.quantum_info import DensityMatrix

from qkd.channels import (
    FIBRE_ATTENUATION_LENGTH_KM,
    AmplitudeDamping,
    Channel,
    IdealChannel,
)


class TestContract:
    def test_channel_cannot_be_instantiated(self):
        """The base class is an interface, not a usable channel."""
        with pytest.raises(TypeError):
            Channel()

    def test_a_subclass_must_implement_apply(self):
        class Incomplete(Channel):
            name = "incomplete"

        with pytest.raises(TypeError):
            Incomplete()

    def test_every_channel_declares_a_name(self):
        """The identifier the registry and the saved presets rely on."""
        assert IdealChannel.name == "ideal"
        assert isinstance(IdealChannel.name, str)


class TestIdealChannel:
    def test_leaves_the_circuit_unchanged(self):
        """No instruction added: nothing happens in transit."""
        qc = QuantumCircuit(1)
        qc.h(0)
        before = qc.data.copy()

        result = IdealChannel().apply(qc, 0)

        assert list(result.data) == list(before)

    def test_returns_a_circuit(self):
        """Channels compose, so apply has to hand back something appliable."""
        qc = QuantumCircuit(1)
        assert isinstance(IdealChannel().apply(qc, 0), QuantumCircuit)

    def test_does_not_mutate_the_caller_circuit(self):
        """The contract every channel inherits from the abstract method.

        A protocol builds one circuit and reuses it for every qubit. If a
        channel worked in place, the noise would pile up pass after pass and the
        QBER would climb for no visible reason. Asserting it on the ideal case
        pins the contract now, so that E2's damping is written against it.
        """
        qc = QuantumCircuit(1)
        qc.h(0)

        returned = IdealChannel().apply(qc, 0)

        assert returned is not qc
        assert len(qc.data) == 1

    def test_is_a_channel(self):
        assert isinstance(IdealChannel(), Channel)


class TestAmplitudeDampingConstruction:
    def test_rejects_gamma_outside_the_unit_interval(self):
        with pytest.raises(ValueError):
            AmplitudeDamping(-0.1)
        with pytest.raises(ValueError):
            AmplitudeDamping(1.1)

    def test_zero_length_fibre_loses_nothing(self):
        assert AmplitudeDamping.from_length(0).gamma == 0.0

    def test_one_attenuation_length_loses_the_expected_fraction(self):
        """At L = L0 the transmission is 1/e, so gamma = 1 - 1/e ~ 0.632."""
        channel = AmplitudeDamping.from_length(FIBRE_ATTENUATION_LENGTH_KM)
        assert channel.gamma == pytest.approx(1 - 1 / math.e)

    def test_loss_grows_with_distance_and_saturates(self):
        gammas = [AmplitudeDamping.from_length(km).gamma for km in (0, 5, 15, 50, 500)]
        assert gammas == sorted(gammas)
        assert gammas[-1] == pytest.approx(1.0, abs=1e-6)

    def test_half_the_photons_are_lost_after_about_fifteen_km(self):
        """The number worth quoting in the report: this is why links are short."""
        assert AmplitudeDamping.from_length(15).gamma == pytest.approx(0.5, abs=0.02)

    def test_rejects_a_negative_length(self):
        with pytest.raises(ValueError):
            AmplitudeDamping.from_length(-1)


class TestKrausOperators:
    @pytest.mark.parametrize("gamma", [0.0, 0.1, 0.3, 0.7, 1.0])
    def test_completeness_relation_holds(self, gamma):
        """sum_i K_i^dagger K_i = I.

        This is what makes the map trace-preserving, hence what guarantees a
        density matrix stays a density matrix. Asserted numerically rather than
        trusted from the algebra.
        """
        operators = AmplitudeDamping(gamma).kraus_operators()
        total = sum(k.conj().T @ k for k in operators)
        assert np.allclose(total, np.eye(2))

    def test_the_operators_are_the_expected_ones(self):
        k0, k1 = AmplitudeDamping(0.36).kraus_operators()
        assert np.allclose(k0, [[1.0, 0.0], [0.0, 0.8]])
        assert np.allclose(k1, [[0.0, 0.6], [0.0, 0.0]])

    def test_the_channel_is_asymmetric(self):
        """|0> is a fixed point, |1> is not. This is the whole point.

        A symmetric channel — depolarizing, or a classical bit flip — would move
        both, and could not produce the basis-dependent QBER below.
        """
        channel = AmplitudeDamping(0.4)

        ground = QuantumCircuit(1)
        assert DensityMatrix(channel.apply(ground, 0)).probabilities()[0] == 1.0

        excited = QuantumCircuit(1)
        excited.x(0)
        assert DensityMatrix(channel.apply(excited, 0)).probabilities()[0] == pytest.approx(0.4)


class TestBasisDependentQber:
    """The experimental fingerprint of amplitude damping.

    QBER_Z = gamma/2 and QBER_X = (1 - sqrt(1-gamma))/2, so the Z basis is about
    twice as noisy. E4 has to reproduce this; a curve where the two bases
    coincide means the channel is wrong.
    """

    @staticmethod
    def _error_probability(gamma, basis, bit):
        """Prepare `bit` in `basis`, send it through, read it back in `basis`."""
        qc = QuantumCircuit(1)
        if bit == 1:
            qc.x(0)
        if basis == 1:
            qc.h(0)

        qc = AmplitudeDamping(gamma).apply(qc, 0)

        if basis == 1:
            qc.h(0)
        return DensityMatrix(qc).probabilities()[1 - bit]

    @pytest.mark.parametrize("gamma", [0.1, 0.3, 0.6])
    def test_z_basis_matches_the_closed_form(self, gamma):
        """|0> survives untouched, |1> decays with probability gamma."""
        assert self._error_probability(gamma, basis=0, bit=0) == pytest.approx(0.0)
        assert self._error_probability(gamma, basis=0, bit=1) == pytest.approx(gamma)

        averaged = sum(self._error_probability(gamma, 0, b) for b in (0, 1)) / 2
        assert averaged == pytest.approx(gamma / 2)

    @pytest.mark.parametrize("gamma", [0.1, 0.3, 0.6])
    def test_x_basis_matches_the_closed_form(self, gamma):
        expected = (1 - math.sqrt(1 - gamma)) / 2
        for bit in (0, 1):
            assert self._error_probability(gamma, basis=1, bit=bit) == pytest.approx(expected)

    @pytest.mark.parametrize("gamma", [0.05, 0.1, 0.2])
    def test_the_z_basis_is_about_twice_as_noisy(self, gamma):
        """The claim the report rests on, checked in the small-gamma regime.

        QBER_X ~ gamma/4 to first order, against QBER_Z = gamma/2 exactly.
        """
        qber_z = sum(self._error_probability(gamma, 0, b) for b in (0, 1)) / 2
        qber_x = self._error_probability(gamma, 1, 0)
        assert qber_z / qber_x == pytest.approx(2.0, rel=0.1)


class TestAmplitudeDampingContract:
    def test_zero_gamma_leaves_the_state_alone(self):
        """The identity case: it must agree with IdealChannel physically."""
        qc = QuantumCircuit(1)
        qc.h(0)
        damped = DensityMatrix(AmplitudeDamping(0.0).apply(qc, 0))
        assert np.allclose(damped.data, DensityMatrix(qc).data)

    def test_does_not_mutate_the_caller_circuit(self):
        qc = QuantumCircuit(1)
        qc.h(0)
        returned = AmplitudeDamping(0.3).apply(qc, 0)
        assert returned is not qc
        assert len(qc.data) == 1
        assert len(returned.data) == 2

    def test_acts_only_on_the_named_qubit(self):
        """E91 carries two arms, and F6 attacks only one of them."""
        qc = QuantumCircuit(2)
        qc.x(0)
        qc.x(1)
        damped = DensityMatrix(AmplitudeDamping(1.0).apply(qc, 0))
        # qubit 0 fully decayed to |0>, qubit 1 still excited: state is |10>.
        assert damped.probabilities([0])[0] == pytest.approx(1.0)
        assert damped.probabilities([1])[1] == pytest.approx(1.0)

    def test_is_a_channel_with_a_name(self):
        assert isinstance(AmplitudeDamping(0.1), Channel)
        assert AmplitudeDamping.name == "amplitude_damping"
